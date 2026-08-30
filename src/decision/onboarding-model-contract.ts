import {
  CITY_PREFERENCE_IDS,
  COUNTRY_PREFERENCE_IDS,
  ONBOARDING_BASE_FIELD_IDS,
  PARTICIPANT_LEAF_IDS,
  PREFERENCE_PARTS,
  type CityPreferenceFieldId,
  type CountryPreferenceFieldId,
  type CurrentWorkValue,
  type EducationValue,
  type IsoCountryCode,
  type MonthlyIncomeValue,
  type OnboardingBaseFieldId,
  type OnboardingModelFieldId,
  type ParticipantDescriptor,
  type ParticipantLeafId,
  type ParticipantRosterProposal,
  type ParsedLocalFieldProposal,
  type PassportValue,
  type RemoteContinuationValue,
} from "./onboarding-catalog";
import {
  parseLocalExtractionOutput,
  parseLocalReviewOutput,
} from "./onboarding-model-output";
import {
  cloneOnboardingFieldValueForDecision,
  reconstructOnboardingDraft,
  reviewQuestionnaire,
  type OnboardingDraft,
  type OnboardingFieldId,
  type OnboardingFieldValue,
  type ParticipantRosterValue,
  type QuestionnaireIssue,
  type QuestionnaireApplicability,
  type QuestionnaireFieldState,
} from "./onboarding-questionnaire";
import {
  reconstructOnboardingSessionState,
  type OnboardingSessionState,
  type SessionMessage,
} from "./onboarding-session";

export type ParticipantLeafValue<L extends ParticipantLeafId> =
  L extends "citizenships" ? readonly IsoCountryCode[] :
  L extends "passport" ? PassportValue :
  L extends "current_work" ? CurrentWorkValue :
  L extends "remote_continuation" ? RemoteContinuationValue :
  L extends "monthly_income" ? MonthlyIncomeValue :
  L extends "education" ? EducationValue :
  L extends "relevant_experience_years" ? number : never;

export type GuardedParticipantLeafProposal = {
  readonly [L in ParticipantLeafId]: {
    readonly kind: "participant_leaf";
    readonly descriptor: ParticipantDescriptor;
    readonly leafId: L;
    readonly normalizedValue: ParticipantLeafValue<L>;
  };
}[ParticipantLeafId];

export type GuardedExtractionProposal =
  | {
      readonly kind: "participant_roster";
      readonly roster: readonly ParticipantRosterProposal[];
    }
  | {
      readonly kind: "non_participant_field";
      readonly fieldId:
        | Exclude<OnboardingBaseFieldId, "participants">
        | CountryPreferenceFieldId
        | CityPreferenceFieldId;
      readonly normalizedValue: OnboardingFieldValue;
    }
  | GuardedParticipantLeafProposal;

export interface GuardedExtraction {
  readonly proposals: readonly GuardedExtractionProposal[];
  readonly nextQuestion: string;
}

export interface OnboardingQuestionnaireProjectionField {
  readonly fieldId: OnboardingModelFieldId;
  readonly applicability: QuestionnaireApplicability;
  readonly normalizedValue: ParsedLocalFieldProposal["typedValue"] | null;
}

export interface OnboardingQuestionnaireProjection {
  readonly schemaVersion: "onboarding-questionnaire-projection@1";
  readonly fields: readonly OnboardingQuestionnaireProjectionField[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PARTICIPANT_FIELD = /^participants\.(self|companion\.(?:0|[1-9][0-9]*))\.([a-z_]+)$/;
const DURABLE_PARTICIPANT_FIELD = /^participants\.([0-9a-f-]+)\.([a-z_]+)$/;
const PLACEHOLDERS = new Set(["-", "не знаю", "неизвестно", "unknown", "n/a", "na"]);
const EXPLICIT_EVIDENCE = /[\p{L}\p{N}]/u;
const MAX_PARTICIPANTS = 20;
const MAX_NEXT_QUESTION_UTF8_BYTES = 2_048;
const INVALID_MODEL_CONTRACT_MESSAGE = "Invalid onboarding model contract";

export function guardExtraction(input: {
  readonly session: OnboardingSessionState;
  readonly userMessage: SessionMessage;
  readonly rawModelOutput: unknown;
}): GuardedExtraction {
  const draft = reconstructOnboardingDraft(input.session.draft);
  const message = readCurrentUserMessage(input.userMessage);
  const currentRoster = readCurrentRoster(draft);
  const currentBindings = requireExactBindings(input.session.descriptorBindings, currentRoster);
  const parsed = parseLocalExtractionOutput(input.rawModelOutput);
  if (utf8Bytes(parsed.nextQuestion) > MAX_NEXT_QUESTION_UTF8_BYTES) {
    throw invalidContract();
  }

  const retained = parsed.proposals.filter((proposal) => {
    if (proposal.messageId !== message.messageId) throw invalidContract();
    return retainEvidenceSpan(message.text, proposal.sourceSpan.start, proposal.sourceSpan.end);
  });
  const rosterProposal = retained.find(({ fieldId }) => fieldId === "participants");
  const currentDescriptorRoster = descriptorRoster(currentRoster);
  const candidateRoster = rosterProposal?.fieldId === "participants"
    ? rosterProposal.typedValue
    : currentDescriptorRoster;
  const rosterIsNoOp = rosterProposal?.fieldId === "participants" &&
    rosterProposal.typedValue.length === currentDescriptorRoster.length &&
    rosterProposal.typedValue.every((participant, index) => {
      const current = currentDescriptorRoster[index];
      return current !== undefined &&
        participant.descriptor === current.descriptor &&
        participant.relationship === current.relationship;
    });
  if (candidateRoster.length > MAX_PARTICIPANTS) throw invalidContract();
  const proposedWork = new Map<ParticipantDescriptor, CurrentWorkValue>();
  for (const proposal of retained) {
    const participant = parseParticipantProposalField(proposal.fieldId);
    if (participant?.leafId === "current_work") {
      proposedWork.set(participant.descriptor, proposal.typedValue as CurrentWorkValue);
    }
  }

  const proposals = retained
    .filter((proposal) => proposal.fieldId !== "participants" || !rosterIsNoOp)
    .map((proposal): GuardedExtractionProposal => {
    if (proposal.fieldId === "participants") {
      return deepFreeze({
        kind: "participant_roster" as const,
        roster: proposal.typedValue.map((participant) => ({ ...participant })),
      });
    }
    const participant = parseParticipantProposalField(proposal.fieldId);
    if (participant !== undefined) {
      requireApplicableParticipantProposal({
        ...participant,
        candidateRoster,
        currentBindings,
        draft,
        proposedWork,
      });
      return deepFreeze({
        kind: "participant_leaf" as const,
        descriptor: participant.descriptor,
        leafId: participant.leafId,
        normalizedValue: cloneParticipantLeafValue(proposal.typedValue),
      }) as GuardedParticipantLeafProposal;
    }
    return deepFreeze({
      kind: "non_participant_field" as const,
      fieldId: proposal.fieldId as Exclude<
        typeof proposal.fieldId,
        `participants.${ParticipantDescriptor}.${ParticipantLeafId}` | "participants"
      >,
      normalizedValue: cloneOnboardingFieldValueForDecision(proposal.fieldId, proposal.typedValue),
    });
    });

  return deepFreeze({ proposals, nextQuestion: parsed.nextQuestion });
}

export function isOnboardingGuardContractError(error: unknown): error is TypeError {
  try {
    if (error === null || typeof error !== "object" ||
      Object.getPrototypeOf(error) !== TypeError.prototype ||
      Object.getOwnPropertySymbols(error).length !== 0) return false;
    const message = Object.getOwnPropertyDescriptor(error, "message");
    return message !== undefined && "value" in message &&
      message.value === INVALID_MODEL_CONTRACT_MESSAGE;
  } catch {
    return false;
  }
}

export function projectQuestionnaireForModel(
  session: OnboardingSessionState,
): OnboardingQuestionnaireProjection {
  const current = reconstructOnboardingSessionState(session);
  const draft = current.draft;
  const roster = readCurrentRoster(draft);
  const bindings = requireExactBindings(current.descriptorBindings, roster);
  const descriptorByParticipant = new Map(
    [...bindings].map(([descriptor, participantId]) => [participantId, descriptor] as const),
  );
  const fields = draft.fields.map((field): OnboardingQuestionnaireProjectionField => {
    const fieldId = projectFieldId(field.fieldId, descriptorByParticipant);
    const normalizedValue = field.fieldId === "participants"
      ? descriptorRoster(roster)
      : field.normalizedValue === null
        ? null
        : cloneOnboardingFieldValueForDecision(
            field.fieldId,
            field.normalizedValue,
          ) as ParsedLocalFieldProposal["typedValue"];
    return deepFreeze({ fieldId, applicability: field.applicability, normalizedValue });
  });
  return deepFreeze({ schemaVersion: "onboarding-questionnaire-projection@1" as const, fields });
}

export function reconstructOnboardingQuestionnaireProjection(
  value: unknown,
): OnboardingQuestionnaireProjection {
  const projection = exactRecord(value, ["schemaVersion", "fields"]);
  if (projection.schemaVersion !== "onboarding-questionnaire-projection@1") {
    throw invalidContract();
  }
  const rawFields = denseProjectionArray(projection.fields, 172);
  if (rawFields.length < 39) throw invalidContract();

  const rawRosterField = exactRecord(rawFields[3], ["fieldId", "applicability", "normalizedValue"]);
  if (
    rawRosterField.fieldId !== "participants" ||
    rawRosterField.applicability !== "required" ||
    rawRosterField.normalizedValue === null
  ) {
    throw invalidContract();
  }
  const roster = parseProjectedValue("participants", rawRosterField.normalizedValue) as unknown as
    readonly ParticipantRosterProposal[];
  if (roster.length > MAX_PARTICIPANTS) throw invalidContract();

  const expectedFieldIds = canonicalProjectionFieldIds(roster);
  if (rawFields.length !== expectedFieldIds.length) throw invalidContract();
  const fields = rawFields.map((rawField, index): OnboardingQuestionnaireProjectionField => {
    const field = exactRecord(rawField, ["fieldId", "applicability", "normalizedValue"]);
    const fieldId = expectedFieldIds[index];
    if (
      fieldId === undefined ||
      field.fieldId !== fieldId ||
      (field.applicability !== "required" && field.applicability !== "not_applicable")
    ) {
      throw invalidContract();
    }
    const normalizedValue = fieldId === "participants"
      ? roster
      : field.normalizedValue === null
        ? null
        : parseProjectedValue(fieldId, field.normalizedValue);
    return {
      fieldId,
      applicability: field.applicability,
      normalizedValue,
    };
  });

  reconstructOnboardingDraft({
    schemaVersion: "onboarding-draft@1",
    fields: durableProjectionFields(fields, roster),
  });
  return deepFreeze({
    schemaVersion: "onboarding-questionnaire-projection@1",
    fields,
  });
}

export function corroborateModelReview(input: {
  readonly session: OnboardingSessionState;
  readonly rawModelOutput: unknown;
}): readonly QuestionnaireIssue[] {
  const draft = reconstructOnboardingDraft(input.session.draft);
  const roster = readCurrentRoster(draft);
  const safeBindings = matchingBindings(input.session.descriptorBindings, roster);
  if (safeBindings === undefined) return deepFreeze([]);
  const modelReview = parseLocalReviewOutput(input.rawModelOutput);
  const deterministic = reviewQuestionnaire(draft).issues;
  const modelKeys = new Set<string>();

  for (const issue of modelReview.issues) {
    const fieldId = resolveReviewFieldId(issue.fieldId, safeBindings);
    if (fieldId === undefined) continue;
    modelKeys.add(issueKey({ fieldId, reasonCode: issue.reasonCode }));
  }
  return deepFreeze(deterministic.filter((issue) => modelKeys.has(issueKey(issue))));
}

function readCurrentUserMessage(value: SessionMessage): SessionMessage {
  const message = exactRecord(value, ["messageId", "role", "text"]);
  if (!UUID.test(message.messageId as string) || message.role !== "user" ||
    typeof message.text !== "string") {
    throw invalidContract();
  }
  return {
    messageId: message.messageId as string,
    role: "user",
    text: message.text,
  };
}

function retainEvidenceSpan(
  text: string,
  start: number,
  end: number,
): boolean {
  if (start >= end || end > text.length || splitsSurrogatePair(text, start) || splitsSurrogatePair(text, end)) {
    throw invalidContract();
  }
  const evidence = text.slice(start, end);
  const normalized = evidence.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/\s+/gu, " ").trim();
  if (PLACEHOLDERS.has(normalized)) return false;
  if (!EXPLICIT_EVIDENCE.test(evidence)) throw invalidContract();
  return true;
}

function splitsSurrogatePair(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return false;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

function parseParticipantProposalField(fieldId: string): {
  readonly descriptor: ParticipantDescriptor;
  readonly leafId: ParticipantLeafId;
} | undefined {
  const match = PARTICIPANT_FIELD.exec(fieldId);
  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    !PARTICIPANT_LEAF_IDS.includes(match[2] as ParticipantLeafId)
  ) return undefined;
  return {
    descriptor: match[1] as ParticipantDescriptor,
    leafId: match[2] as ParticipantLeafId,
  };
}

function requireApplicableParticipantProposal(input: {
  readonly descriptor: ParticipantDescriptor;
  readonly leafId: ParticipantLeafId;
  readonly candidateRoster: readonly ParticipantRosterProposal[];
  readonly currentBindings: ReadonlyMap<ParticipantDescriptor, string>;
  readonly draft: OnboardingDraft;
  readonly proposedWork: ReadonlyMap<ParticipantDescriptor, CurrentWorkValue>;
}): void {
  const participant = input.candidateRoster.find(({ descriptor }) => descriptor === input.descriptor);
  if (participant === undefined) throw invalidContract();
  if (input.leafId === "citizenships" || input.leafId === "passport") return;
  if (participant.relationship === "minor_child") throw invalidContract();
  if (input.leafId !== "remote_continuation") return;

  const currentWork = input.proposedWork.get(input.descriptor) ??
    currentParticipantWork(input.descriptor, input.currentBindings, input.draft);
  if (currentWork === undefined || currentWork.status === "not_working") throw invalidContract();
}

function currentParticipantWork(
  descriptor: ParticipantDescriptor,
  bindings: ReadonlyMap<ParticipantDescriptor, string>,
  draft: OnboardingDraft,
): CurrentWorkValue | undefined {
  const participantId = bindings.get(descriptor);
  if (participantId === undefined) return undefined;
  const field = draft.fields.find(({ fieldId }) => fieldId === `participants.${participantId}.current_work`);
  const value = field?.normalizedValue;
  return value !== null && typeof value === "object" && !Array.isArray(value) && "status" in value
    ? value as CurrentWorkValue
    : undefined;
}

function readCurrentRoster(draft: OnboardingDraft): readonly ParticipantRosterValue[] {
  const roster = draft.fields.find(({ fieldId }) => fieldId === "participants")?.normalizedValue;
  if (!Array.isArray(roster) || roster.length > MAX_PARTICIPANTS) throw invalidContract();
  return roster as unknown as readonly ParticipantRosterValue[];
}

function descriptorRoster(roster: readonly ParticipantRosterValue[]): readonly ParticipantRosterProposal[] {
  return roster.map(({ relationship }, index) => ({
    descriptor: (index === 0 ? "self" : `companion.${index - 1}`) as ParticipantDescriptor,
    relationship,
  }));
}

function requireExactBindings(
  value: OnboardingSessionState["descriptorBindings"],
  roster: readonly ParticipantRosterValue[],
): ReadonlyMap<ParticipantDescriptor, string> {
  const bindings = matchingBindings(value, roster);
  if (bindings === undefined) {
    throw invalidContract();
  }
  return bindings;
}

function matchingBindings(
  value: OnboardingSessionState["descriptorBindings"],
  roster: readonly ParticipantRosterValue[],
): ReadonlyMap<ParticipantDescriptor, string> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length > 0) {
    return undefined;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== roster.length) return undefined;
  const result = new Map<ParticipantDescriptor, string>();
  for (const [index, participant] of roster.entries()) {
    const descriptor = (index === 0 ? "self" : `companion.${index - 1}`) as ParticipantDescriptor;
    const binding = descriptors[descriptor];
    if (binding?.enumerable !== true || !("value" in binding) ||
      binding.value !== participant.participantId) return undefined;
    result.set(descriptor, participant.participantId);
  }
  return result;
}

function projectFieldId(
  fieldId: OnboardingFieldId,
  descriptorByParticipant: ReadonlyMap<string, ParticipantDescriptor>,
): OnboardingModelFieldId {
  const match = DURABLE_PARTICIPANT_FIELD.exec(fieldId);
  if (match === null) return fieldId as OnboardingModelFieldId;
  const participantId = match[1];
  const leafId = match[2];
  if (
    participantId === undefined ||
    leafId === undefined ||
    !UUID.test(participantId) ||
    !PARTICIPANT_LEAF_IDS.includes(leafId as ParticipantLeafId)
  ) throw invalidContract();
  const descriptor = descriptorByParticipant.get(participantId);
  if (descriptor === undefined) throw invalidContract();
  return `participants.${descriptor}.${leafId}` as OnboardingModelFieldId;
}

function canonicalProjectionFieldIds(
  roster: readonly ParticipantRosterProposal[],
): OnboardingModelFieldId[] {
  return [
    ...ONBOARDING_BASE_FIELD_IDS,
    ...roster.flatMap(({ descriptor }) =>
      PARTICIPANT_LEAF_IDS.map((leafId) => `participants.${descriptor}.${leafId}` as const)),
    ...COUNTRY_PREFERENCE_IDS.flatMap((preferenceId) =>
      PREFERENCE_PARTS.map((part) => `country_preferences.${preferenceId}.${part}` as const)),
    ...CITY_PREFERENCE_IDS.flatMap((preferenceId) =>
      PREFERENCE_PARTS.map((part) => `city_preferences.${preferenceId}.${part}` as const)),
  ];
}

function parseProjectedValue(
  fieldId: OnboardingModelFieldId,
  value: unknown,
): ParsedLocalFieldProposal["typedValue"] {
  const parsed = parseLocalExtractionOutput({
    schemaVersion: "onboarding-model-output@1",
    proposals: [{
      fieldId,
      typedValue: value,
      messageId: "projection",
      sourceSpan: { start: 0, end: 1 },
    }],
    nextQuestion: "projection",
  });
  const proposal = parsed.proposals[0];
  if (proposal === undefined) throw invalidContract();
  return proposal.typedValue;
}

function durableProjectionFields(
  fields: readonly OnboardingQuestionnaireProjectionField[],
  roster: readonly ParticipantRosterProposal[],
): QuestionnaireFieldState[] {
  const participantIds = new Map<ParticipantDescriptor, string>();
  for (const [index, { descriptor }] of roster.entries()) {
    participantIds.set(descriptor, projectionParticipantId(index));
  }
  return fields.map((field): QuestionnaireFieldState => {
    const fieldId = durableProjectionFieldId(field.fieldId, participantIds);
    const normalizedValue = field.fieldId === "participants"
      ? roster.map(({ descriptor, relationship }) => ({
          participantId: requireProjectionParticipantId(participantIds, descriptor),
          relationship,
        }))
      : field.normalizedValue;
    if (field.applicability === "not_applicable") {
      if (normalizedValue !== null) throw invalidContract();
      return {
        fieldId,
        applicability: "not_applicable",
        rawInput: null,
        normalizedValue: null,
        origin: "empty",
        overwrite: null,
      };
    }
    if (normalizedValue === null) {
      return {
        fieldId,
        applicability: "required",
        rawInput: null,
        normalizedValue: null,
        origin: "empty",
        overwrite: null,
      };
    }
    return {
      fieldId,
      applicability: "required",
      rawInput: null,
      normalizedValue: normalizedValue as OnboardingFieldValue,
      origin: "manual",
      overwrite: null,
    };
  });
}

function durableProjectionFieldId(
  fieldId: OnboardingModelFieldId,
  participantIds: ReadonlyMap<ParticipantDescriptor, string>,
): OnboardingFieldId {
  const participant = parseParticipantProposalField(fieldId);
  if (participant === undefined) return fieldId as OnboardingFieldId;
  const participantId = requireProjectionParticipantId(participantIds, participant.descriptor);
  return `participants.${participantId}.${participant.leafId}`;
}

function requireProjectionParticipantId(
  participantIds: ReadonlyMap<ParticipantDescriptor, string>,
  descriptor: ParticipantDescriptor,
): string {
  const participantId = participantIds.get(descriptor);
  if (participantId === undefined) throw invalidContract();
  return participantId;
}

function projectionParticipantId(index: number): string {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

function resolveReviewFieldId(
  fieldId: string,
  bindings: ReadonlyMap<ParticipantDescriptor, string>,
): OnboardingFieldId | undefined {
  const participant = parseParticipantProposalField(fieldId);
  if (participant === undefined) return fieldId as OnboardingFieldId;
  const participantId = bindings.get(participant.descriptor);
  return participantId === undefined
    ? undefined
    : `participants.${participantId}.${participant.leafId}`;
}

function cloneParticipantLeafValue(value: unknown): GuardedParticipantLeafProposal["normalizedValue"] {
  return deepFreeze(cloneJsonValue(value)) as GuardedParticipantLeafProposal["normalizedValue"];
}

function cloneJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneJsonValue(entry)]));
}

function issueKey(issue: QuestionnaireIssue): string {
  return `${issue.fieldId}\u0000${issue.reasonCode}`;
}

function exactRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) {
    throw invalidContract();
  }
  const keys = Object.getOwnPropertyNames(value);
  if (keys.length !== expectedKeys.length || !expectedKeys.every((key) => keys.includes(key))) {
    throw invalidContract();
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true || !("value" in descriptor)) throw invalidContract();
    result[key] = descriptor.value;
  }
  return result;
}

function denseProjectionArray(value: unknown, maximumLength: number): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length > 0 ||
    value.length > maximumLength
  ) {
    throw invalidContract();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expectedKeys = new Set([
    ...Array.from({ length: value.length }, (_, index) => String(index)),
    "length",
  ]);
  if (Object.keys(descriptors).some((key) => !expectedKeys.has(key))) throw invalidContract();
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor?.enumerable !== true || !("value" in descriptor)) throw invalidContract();
    result.push(descriptor.value);
  }
  return result;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function invalidContract(): TypeError {
  return new TypeError(INVALID_MODEL_CONTRACT_MESSAGE);
}
