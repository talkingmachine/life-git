import { types } from "node:util";

import type {
  LocalExtractionResult,
  OnboardingModelFieldId,
} from "../../decision/onboarding-catalog";
import {
  CITY_PREFERENCE_IDS,
  COUNTRY_PREFERENCE_IDS,
  ONBOARDING_BASE_FIELD_IDS,
  PARTICIPANT_LEAF_IDS,
  PREFERENCE_PARTS,
} from "../../decision/onboarding-catalog";
import { parseLocalExtractionOutput } from "../../decision/onboarding-model-output";
import type { JsonObject, JsonValue } from "./owned-json";

const MAX_PROPOSALS = 100;
const PARTICIPANT_DESCRIPTOR_COUNT = 20;
const LOWERCASE_RFC_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface OnboardingExtractionWireCodebookEntry {
  readonly code: string;
  readonly fieldId: OnboardingModelFieldId;
}

export const ONBOARDING_EXTRACTION_WIRE_ALGEBRA = [
  "Address algebra (all indices are zero-based ASCII decimal with no leading zeroes; + is string concatenation):",
  `B=[${ONBOARDING_BASE_FIELD_IDS.join(",")}];`,
  `L=[${PARTICIPANT_LEAF_IDS.join(",")}];`,
  `K=[${COUNTRY_PREFERENCE_IDS.join(",")}];`,
  `C=[${CITY_PREFERENCE_IDS.join(",")}];`,
  `P=[${PREFERENCE_PARTS.join(",")}].`,
  `decode("b"+N)=B[N], N=0..${ONBOARDING_BASE_FIELD_IDS.length - 1}.`,
  `participant(0)="self"; participant(D)="companion."+(D-1), D=1..${PARTICIPANT_DESCRIPTOR_COUNT - 1}.`,
  `decode("p"+D+"."+J)="participants."+participant(D)+"."+L[J], D=0..${PARTICIPANT_DESCRIPTOR_COUNT - 1},J=0..${PARTICIPANT_LEAF_IDS.length - 1}.`,
  `decode("k"+I+"."+J)="country_preferences."+K[I]+"."+P[J], I=0..${COUNTRY_PREFERENCE_IDS.length - 1},J=0..${PREFERENCE_PARTS.length - 1}.`,
  `decode("c"+I+"."+J)="city_preferences."+C[I]+"."+P[J], I=0..${CITY_PREFERENCE_IDS.length - 1},J=0..${PREFERENCE_PARTS.length - 1}.`,
  "No other f is valid.",
].join("\n");

export const ONBOARDING_EXTRACTION_WIRE_CODEBOOK = Object.freeze([
  ...ONBOARDING_BASE_FIELD_IDS.map((fieldId, index) => codebookEntry(`b${index}`, fieldId)),
  ...Array.from({ length: PARTICIPANT_DESCRIPTOR_COUNT }, (_, descriptorIndex) =>
    PARTICIPANT_LEAF_IDS.map((leafId, leafIndex) => codebookEntry(
      `p${descriptorIndex}.${leafIndex}`,
      `participants.${participantDescriptor(descriptorIndex)}.${leafId}`,
    ))).flat(),
  ...COUNTRY_PREFERENCE_IDS.flatMap((criterionId, criterionIndex) =>
    PREFERENCE_PARTS.map((part, partIndex) => codebookEntry(
      `k${criterionIndex}.${partIndex}`,
      `country_preferences.${criterionId}.${part}`,
    ))),
  ...CITY_PREFERENCE_IDS.flatMap((criterionId, criterionIndex) =>
    PREFERENCE_PARTS.map((part, partIndex) => codebookEntry(
      `c${criterionIndex}.${partIndex}`,
      `city_preferences.${criterionId}.${part}`,
    ))),
] as const);

const FIELD_ID_BY_CODE = new Map(
  ONBOARDING_EXTRACTION_WIRE_CODEBOOK.map(({ code, fieldId }) => [code, fieldId]),
);

export function decodeOnboardingExtractionWire(input: {
  readonly value: unknown;
  readonly messageId: string;
}): LocalExtractionResult {
  const borrowedInput = readExactBorrowedRecord(input, ["value", "messageId"]);
  const messageId = requireMessageId(borrowedInput.messageId);
  const wire = readExactSnapshotRecord(snapshotWireJson(borrowedInput.value), [
    "schemaVersion",
    "proposals",
    "nextQuestion",
  ]);
  if (wire.schemaVersion !== "onboarding-extraction-wire@2") throw invalidWire();

  const proposals = readDenseSnapshotArray(wire.proposals, MAX_PROPOSALS).map((value) => {
    const proposal = readExactSnapshotRecord(value, ["f", "v", "s", "e"]);
    const fieldId = decodeFieldAddress(proposal.f);
    return {
      fieldId,
      typedValue: proposal.v,
      messageId,
      sourceSpan: { start: proposal.s, end: proposal.e },
    };
  });

  return deepFreeze(parseLocalExtractionOutput({
    schemaVersion: "onboarding-model-output@1",
    proposals,
    nextQuestion: wire.nextQuestion,
  }));
}

function codebookEntry(
  code: string,
  fieldId: OnboardingModelFieldId,
): OnboardingExtractionWireCodebookEntry {
  return Object.freeze({ code, fieldId });
}

function participantDescriptor(index: number): "self" | `companion.${number}` {
  return index === 0 ? "self" : `companion.${index - 1}`;
}

function decodeFieldAddress(value: unknown): OnboardingModelFieldId {
  if (typeof value !== "string") throw invalidWire();
  const fieldId = FIELD_ID_BY_CODE.get(value);
  if (fieldId === undefined) throw invalidWire();
  return fieldId;
}

function requireMessageId(value: unknown): string {
  if (typeof value !== "string" || !LOWERCASE_RFC_UUID.test(value)) throw invalidWire();
  return value;
}

function snapshotWireJson(value: unknown): JsonValue {
  return snapshotJsonValue(value, new Set<object>());
}

function snapshotJsonValue(value: unknown, ancestors: Set<object>): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || types.isProxy(value) || ancestors.has(value)) throw invalidWire();

  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? snapshotJsonArray(value, ancestors)
      : snapshotJsonObject(value, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

function snapshotJsonArray(value: unknown[], ancestors: Set<object>): readonly JsonValue[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) throw invalidWire();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) throw invalidWire();

  const snapshot = new Array<JsonValue>(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor)) {
      throw invalidWire();
    }
    snapshot[index] = snapshotJsonValue(descriptor.value, ancestors);
  }
  return snapshot;
}

function snapshotJsonObject(value: object, ancestors: Set<object>): JsonObject {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalidWire();

  const snapshot = Object.create(null) as Record<string, JsonValue>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw invalidWire();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor)) {
      throw invalidWire();
    }
    snapshot[key] = snapshotJsonValue(descriptor.value, ancestors);
  }
  return snapshot;
}

function readExactBorrowedRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) {
    throw invalidWire();
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalidWire();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== expectedKeys.length) throw invalidWire();

  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor)) {
      throw invalidWire();
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function readExactSnapshotRecord(
  value: JsonValue,
  expectedKeys: readonly string[],
): Readonly<Record<string, JsonValue>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalidWire();
  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.length || !expectedKeys.every((key) => keys.includes(key))) {
    throw invalidWire();
  }
  return value as JsonObject;
}

function readDenseSnapshotArray(value: JsonValue, maximumLength: number): readonly JsonValue[] {
  if (!Array.isArray(value) || value.length > maximumLength) throw invalidWire();
  return value;
}

function invalidWire(): TypeError {
  return new TypeError("Invalid onboarding extraction wire");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
