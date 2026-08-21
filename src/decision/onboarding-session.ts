import {
  type ParticipantDescriptor,
  type ParticipantLeafId,
  type ParticipantRelationship,
  type ParticipantRosterProposal,
} from "./onboarding-catalog";
import type {
  GuardedExtraction,
  GuardedExtractionProposal,
} from "./onboarding-model-contract";
import {
  applyQuestionnaireFieldChange,
  cloneOnboardingFieldValueForDecision,
  createOnboardingDraft,
  parseOnboardingFieldIdForDecision,
  reconstructOnboardingDraft,
  type OnboardingDraft,
  type OnboardingFieldId,
  type ParticipantRosterValue,
  type QuestionnaireFieldChange,
} from "./onboarding-questionnaire";

export interface SessionMessage {
  readonly messageId: string;
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface OnboardingSessionState {
  readonly sessionVersion: "onboarding-session@1";
  readonly completionCommandId: string;
  readonly messages: readonly SessionMessage[];
  readonly draft: OnboardingDraft;
  readonly descriptorBindings: Readonly<Partial<Record<ParticipantDescriptor, string>>>;
}

export const ONBOARDING_SESSION_LIMITS = Object.freeze({
  maxMessages: 64,
  maxMessageUtf8Bytes: 8_192,
  maxSessionUtf8Bytes: 114_688,
  maxParticipants: 20,
  maxFields: 172,
  maxNextQuestionUtf8Bytes: 2_048,
} as const);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PARTICIPANT_LEAVES = [
  "citizenships",
  "passport",
  "current_work",
  "remote_continuation",
  "monthly_income",
  "education",
  "relevant_experience_years",
] as const satisfies readonly ParticipantLeafId[];
const RELATIONSHIPS = new Set<ParticipantRelationship>([
  "self",
  "spouse",
  "minor_child",
  "other_family",
]);
const SENTINEL_PARTICIPANT_ID = "00000000-0000-4000-8000-000000000001";

export function createOnboardingSession(input: {
  readonly nextParticipantId: () => string;
  readonly nextCompletionCommandId: () => string;
}): OnboardingSessionState {
  const participantId = readUuid(input.nextParticipantId());
  const completionCommandId = readFreshUuid(input.nextCompletionCommandId(), new Set([participantId]));
  return finalizeSession({
    sessionVersion: "onboarding-session@1",
    completionCommandId,
    messages: [],
    draft: createOnboardingDraft(() => participantId),
    descriptorBindings: { self: participantId },
  });
}

export function applyGuardedExtraction(input: {
  readonly session: OnboardingSessionState;
  readonly userMessage: SessionMessage;
  readonly extraction: GuardedExtraction;
  readonly nextParticipantId: () => string;
  readonly nextAssistantMessageId: () => string;
  readonly nextCompletionCommandId: () => string;
}): OnboardingSessionState {
  const session = reconstructOnboardingSessionState(input.session);
  const userMessage = readMessage(input.userMessage);
  if (userMessage.role !== "user" || allSessionIds(session).has(userMessage.messageId)) {
    throw invalidSession();
  }
  if (session.messages.length + 2 > ONBOARDING_SESSION_LIMITS.maxMessages) throw invalidSession();

  const extraction = readGuardedExtraction(input.extraction);
  const currentRoster = readRoster(session.draft);
  const currentBindings = bindingsForRoster(session.descriptorBindings, currentRoster);
  const rosterProposal = extraction.proposals.find(({ kind }) => kind === "participant_roster");
  const candidateRoster = rosterProposal?.kind === "participant_roster"
    ? rosterProposal.roster
    : currentRoster.map(({ relationship }, index) => ({
        descriptor: descriptorAt(index),
        relationship,
      }));
  assertUnambiguousModelRoster(currentRoster, candidateRoster);
  validateGuardedProposalSet(extraction.proposals, candidateRoster, session.draft, currentBindings);

  const forbiddenIds = allSessionIds(session);
  forbiddenIds.add(userMessage.messageId);
  const assistantMessageId = readFreshUuid(input.nextAssistantMessageId(), forbiddenIds);
  forbiddenIds.add(assistantMessageId);

  const nextBindings: Record<string, string> = Object.create(null) as Record<string, string>;
  const durableRoster: ParticipantRosterValue[] = [];
  for (const [index, participant] of candidateRoster.entries()) {
    const descriptor = descriptorAt(index);
    const existingId = currentBindings.get(descriptor);
    const participantId = existingId ?? readFreshUuid(input.nextParticipantId(), forbiddenIds);
    forbiddenIds.add(participantId);
    nextBindings[descriptor] = participantId;
    durableRoster.push({ participantId, relationship: participant.relationship });
  }

  let nextDraft = session.draft;
  if (rosterProposal?.kind === "participant_roster") {
    nextDraft = applyQuestionnaireFieldChange(nextDraft, {
      kind: "guarded_model_set",
      fieldId: "participants",
      normalizedValue: durableRoster,
    });
  }

  const changes = extraction.proposals
    .filter((proposal) => proposal.kind !== "participant_roster")
    .map((proposal) => guardedChange(proposal, nextBindings));
  const fieldOrder = new Map(nextDraft.fields.map(({ fieldId }, index) => [fieldId, index]));
  changes.sort((left, right) =>
    (fieldOrder.get(left.fieldId) ?? Number.MAX_SAFE_INTEGER) -
    (fieldOrder.get(right.fieldId) ?? Number.MAX_SAFE_INTEGER));
  for (const change of changes) nextDraft = applyQuestionnaireFieldChange(nextDraft, change);

  const messages = [
    ...session.messages,
    userMessage,
    { messageId: assistantMessageId, role: "assistant" as const, text: extraction.nextQuestion },
  ];
  const authoritativeChanged = authorityJson(session.draft) !== authorityJson(nextDraft);
  const completionCommandId = authoritativeChanged
    ? readFreshUuid(input.nextCompletionCommandId(), forbiddenIds)
    : session.completionCommandId;

  return finalizeSession({
    sessionVersion: "onboarding-session@1",
    completionCommandId,
    messages,
    draft: nextDraft,
    descriptorBindings: nextBindings,
  });
}

export function applySessionFieldChange(input: {
  readonly session: OnboardingSessionState;
  readonly change: QuestionnaireFieldChange;
  readonly nextCompletionCommandId: () => string;
}): OnboardingSessionState {
  const session = reconstructOnboardingSessionState(input.session);
  const draft = applyQuestionnaireFieldChange(session.draft, input.change);
  const roster = readRoster(draft);
  const descriptorBindings = Object.fromEntries(
    roster.map(({ participantId }, index) => [descriptorAt(index), participantId]),
  );
  const nonParticipantIds = new Set([
    session.completionCommandId,
    ...session.messages.map(({ messageId }) => messageId),
  ]);
  for (const { participantId } of roster) {
    if (nonParticipantIds.has(participantId)) throw invalidSession();
  }
  const authoritativeChanged = authorityJson(session.draft) !== authorityJson(draft);
  const forbiddenCommandIds = new Set([
    ...nonParticipantIds,
    ...roster.map(({ participantId }) => participantId),
  ]);
  const completionCommandId = authoritativeChanged
    ? readFreshUuid(input.nextCompletionCommandId(), forbiddenCommandIds)
    : session.completionCommandId;
  return finalizeSession({
    sessionVersion: "onboarding-session@1",
    completionCommandId,
    messages: session.messages,
    draft,
    descriptorBindings,
  });
}

export function reconstructOnboardingSessionState(value: unknown): OnboardingSessionState {
  const record = exactRecord(value, [
    "sessionVersion",
    "completionCommandId",
    "messages",
    "draft",
    "descriptorBindings",
  ]);
  if (record.sessionVersion !== "onboarding-session@1") throw invalidSession();
  const completionCommandId = readUuid(record.completionCommandId);
  const messages = denseArray(record.messages, ONBOARDING_SESSION_LIMITS.maxMessages).map(readMessage);
  const messageIds = messages.map(({ messageId }) => messageId);
  assertUnique(messageIds);
  const draft = reconstructOnboardingDraft(record.draft);
  const roster = readRoster(draft);
  if (roster.length > ONBOARDING_SESSION_LIMITS.maxParticipants ||
    draft.fields.length > ONBOARDING_SESSION_LIMITS.maxFields) throw invalidSession();
  const descriptorBindings = readBindings(record.descriptorBindings, roster);
  const participantIds = roster.map(({ participantId }) => participantId);
  assertUnique([completionCommandId, ...participantIds, ...messageIds]);
  return finalizeSession({
    sessionVersion: "onboarding-session@1",
    completionCommandId,
    messages,
    draft,
    descriptorBindings,
  });
}

function readGuardedExtraction(value: GuardedExtraction): GuardedExtraction {
  const record = exactRecord(value, ["proposals", "nextQuestion"]);
  if (typeof record.nextQuestion !== "string" || record.nextQuestion.trim().length === 0 ||
    utf8Bytes(record.nextQuestion) > ONBOARDING_SESSION_LIMITS.maxNextQuestionUtf8Bytes) {
    throw invalidSession();
  }
  const proposals = denseArray(record.proposals, ONBOARDING_SESSION_LIMITS.maxFields)
    .map(readGuardedProposal);
  assertUnique(proposals.map(proposalKey));
  if (proposals.filter(({ kind }) => kind === "participant_roster").length > 1) {
    throw invalidSession();
  }
  return deepFreeze({ proposals, nextQuestion: record.nextQuestion });
}

function readGuardedProposal(value: unknown): GuardedExtractionProposal {
  const record = snapshotRecord(value);
  if (record === null || typeof record.kind !== "string") throw invalidSession();
  if (record.kind === "participant_roster") {
    requireExactKeys(record, ["kind", "roster"]);
    const roster = denseArray(record.roster, ONBOARDING_SESSION_LIMITS.maxParticipants)
      .map(readDescriptorRosterEntry);
    assertCanonicalDescriptorRoster(roster);
    return { kind: "participant_roster", roster };
  }
  if (record.kind === "participant_leaf") {
    requireExactKeys(record, ["kind", "descriptor", "leafId", "normalizedValue"]);
    const descriptor = readDescriptor(record.descriptor);
    const leafId = readParticipantLeaf(record.leafId);
    const fieldId = `participants.${SENTINEL_PARTICIPANT_ID}.${leafId}` as OnboardingFieldId;
    return {
      kind: "participant_leaf",
      descriptor,
      leafId,
      normalizedValue: cloneOnboardingFieldValueForDecision(fieldId, record.normalizedValue),
    } as GuardedExtractionProposal;
  }
  if (record.kind === "non_participant_field") {
    requireExactKeys(record, ["kind", "fieldId", "normalizedValue"]);
    const fieldId = parseOnboardingFieldIdForDecision(record.fieldId);
    if (fieldId === "participants" || fieldId.startsWith("participants.")) throw invalidSession();
    return {
      kind: "non_participant_field",
      fieldId,
      normalizedValue: cloneOnboardingFieldValueForDecision(fieldId, record.normalizedValue),
    } as GuardedExtractionProposal;
  }
  throw invalidSession();
}

function validateGuardedProposalSet(
  proposals: readonly GuardedExtractionProposal[],
  roster: readonly ParticipantRosterProposal[],
  draft: OnboardingDraft,
  bindings: ReadonlyMap<ParticipantDescriptor, string>,
): void {
  const plannedWork = new Map<ParticipantDescriptor, unknown>();
  for (const proposal of proposals) {
    if (proposal.kind === "participant_leaf" && proposal.leafId === "current_work") {
      plannedWork.set(proposal.descriptor, proposal.normalizedValue);
    }
  }
  for (const proposal of proposals) {
    if (proposal.kind !== "participant_leaf") continue;
    const participant = roster.find(({ descriptor }) => descriptor === proposal.descriptor);
    if (participant === undefined) throw invalidSession();
    if (proposal.leafId === "citizenships" || proposal.leafId === "passport") continue;
    if (participant.relationship === "minor_child") throw invalidSession();
    if (proposal.leafId !== "remote_continuation") continue;
    const work = plannedWork.get(proposal.descriptor) ?? currentWork(proposal.descriptor, bindings, draft);
    if (work === null || typeof work !== "object" || !("status" in work) || work.status === "not_working") {
      throw invalidSession();
    }
  }
}

function currentWork(
  descriptor: ParticipantDescriptor,
  bindings: ReadonlyMap<ParticipantDescriptor, string>,
  draft: OnboardingDraft,
): unknown {
  const participantId = bindings.get(descriptor);
  if (participantId === undefined) return undefined;
  return draft.fields.find(({ fieldId }) =>
    fieldId === `participants.${participantId}.current_work`)?.normalizedValue;
}

function guardedChange(
  proposal: Exclude<GuardedExtractionProposal, { readonly kind: "participant_roster" }>,
  bindings: Readonly<Record<string, string>>,
): QuestionnaireFieldChange & { readonly kind: "guarded_model_set" } {
  if (proposal.kind === "non_participant_field") {
    return { kind: "guarded_model_set", fieldId: proposal.fieldId, normalizedValue: proposal.normalizedValue };
  }
  const participantId = bindings[proposal.descriptor];
  if (participantId === undefined) throw invalidSession();
  return {
    kind: "guarded_model_set",
    fieldId: `participants.${participantId}.${proposal.leafId}`,
    normalizedValue: proposal.normalizedValue,
  };
}

function assertUnambiguousModelRoster(
  current: readonly ParticipantRosterValue[],
  candidate: readonly ParticipantRosterProposal[],
): void {
  if (candidate.length < 1 || candidate.length > ONBOARDING_SESSION_LIMITS.maxParticipants) {
    throw invalidSession();
  }
  const sharedLength = Math.min(current.length, candidate.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (current[index]?.relationship !== candidate[index]?.relationship) throw invalidSession();
  }
}

function readDescriptorRosterEntry(value: unknown): ParticipantRosterProposal {
  const record = exactRecord(value, ["descriptor", "relationship"]);
  const descriptor = readDescriptor(record.descriptor);
  if (typeof record.relationship !== "string" ||
    !RELATIONSHIPS.has(record.relationship as ParticipantRelationship)) throw invalidSession();
  return { descriptor, relationship: record.relationship as ParticipantRelationship };
}

function assertCanonicalDescriptorRoster(roster: readonly ParticipantRosterProposal[]): void {
  if (roster.length < 1 || roster[0]?.relationship !== "self") throw invalidSession();
  for (const [index, participant] of roster.entries()) {
    if (participant.descriptor !== descriptorAt(index) ||
      (index > 0 && participant.relationship === "self")) throw invalidSession();
  }
}

function readDescriptor(value: unknown): ParticipantDescriptor {
  if (value === "self") return value;
  if (typeof value !== "string" || !/^companion\.(?:0|[1-9][0-9]*)$/.test(value)) {
    throw invalidSession();
  }
  return value as ParticipantDescriptor;
}

function readParticipantLeaf(value: unknown): ParticipantLeafId {
  if (typeof value !== "string" || !PARTICIPANT_LEAVES.includes(value as ParticipantLeafId)) {
    throw invalidSession();
  }
  return value as ParticipantLeafId;
}

function proposalKey(proposal: GuardedExtractionProposal): string {
  if (proposal.kind === "participant_roster") return "participants";
  if (proposal.kind === "non_participant_field") return proposal.fieldId;
  return `participants.${proposal.descriptor}.${proposal.leafId}`;
}

function readMessage(value: unknown): SessionMessage {
  const record = exactRecord(value, ["messageId", "role", "text"]);
  const messageId = readUuid(record.messageId);
  if ((record.role !== "user" && record.role !== "assistant") ||
    typeof record.text !== "string" || record.text.trim().length === 0 ||
    utf8Bytes(record.text) > ONBOARDING_SESSION_LIMITS.maxMessageUtf8Bytes) throw invalidSession();
  return { messageId, role: record.role, text: record.text };
}

function readBindings(
  value: unknown,
  roster: readonly ParticipantRosterValue[],
): Readonly<Record<string, string>> {
  const record = snapshotRecord(value);
  if (record === null || Object.keys(record).length !== roster.length) throw invalidSession();
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [index, participant] of roster.entries()) {
    const descriptor = descriptorAt(index);
    if (record[descriptor] !== participant.participantId) throw invalidSession();
    result[descriptor] = participant.participantId;
  }
  return result;
}

function bindingsForRoster(
  value: OnboardingSessionState["descriptorBindings"],
  roster: readonly ParticipantRosterValue[],
): ReadonlyMap<ParticipantDescriptor, string> {
  const bindings = readBindings(value, roster);
  return new Map(Object.entries(bindings) as [ParticipantDescriptor, string][]);
}

function readRoster(draft: OnboardingDraft): readonly ParticipantRosterValue[] {
  const value = draft.fields.find(({ fieldId }) => fieldId === "participants")?.normalizedValue;
  if (!Array.isArray(value)) throw invalidSession();
  return value as unknown as readonly ParticipantRosterValue[];
}

function descriptorAt(index: number): ParticipantDescriptor {
  return (index === 0 ? "self" : `companion.${index - 1}`) as ParticipantDescriptor;
}

function authorityJson(draft: OnboardingDraft): string {
  return JSON.stringify(draft.fields.map(({ fieldId, applicability, normalizedValue, origin, overwrite }) => ({
    fieldId,
    applicability,
    normalizedValue,
    origin,
    overwrite,
  })));
}

function allSessionIds(session: OnboardingSessionState): Set<string> {
  return new Set([
    session.completionCommandId,
    ...session.messages.map(({ messageId }) => messageId),
    ...readRoster(session.draft).map(({ participantId }) => participantId),
  ]);
}

function finalizeSession(value: OnboardingSessionState): OnboardingSessionState {
  const owned = {
    sessionVersion: "onboarding-session@1" as const,
    completionCommandId: value.completionCommandId,
    messages: value.messages.map((message) => ({ ...message })),
    draft: reconstructOnboardingDraft(value.draft),
    descriptorBindings: Object.fromEntries(Object.entries(value.descriptorBindings)),
  };
  assertUnique([
    owned.completionCommandId,
    ...owned.messages.map(({ messageId }) => messageId),
    ...readRoster(owned.draft).map(({ participantId }) => participantId),
  ]);
  if (utf8Bytes(JSON.stringify(owned)) > ONBOARDING_SESSION_LIMITS.maxSessionUtf8Bytes) {
    throw invalidSession();
  }
  return deepFreeze(owned);
}

function readUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw invalidSession();
  return value;
}

function readFreshUuid(value: unknown, forbidden: ReadonlySet<string>): string {
  const id = readUuid(value);
  if (forbidden.has(id)) throw invalidSession();
  return id;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const record = snapshotRecord(value);
  if (record === null) throw invalidSession();
  requireExactKeys(record, keys);
  return record;
}

function snapshotRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length !== 0) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor) || !descriptor.enumerable) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function requireExactKeys(record: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(record);
  if (actual.length !== keys.length || !keys.every((key) => key in record)) throw invalidSession();
}

function denseArray(value: unknown, maximumLength: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0 || value.length > maximumLength) throw invalidSession();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = new Set([...Array.from({ length: value.length }, (_, index) => String(index)), "length"]);
  if (Object.keys(descriptors).some((key) => !names.has(key))) throw invalidSession();
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) throw invalidSession();
    return descriptor.value;
  });
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) throw invalidSession();
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function invalidSession(): TypeError {
  return new TypeError("Invalid onboarding session");
}
