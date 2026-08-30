import { types } from "node:util";
import { canonicalHttpsUrl } from "./official-source-discovery";

export type CitySourceBindingKeyV1 = Readonly<{
  schemaVersion: "city-source-binding-key@1";
  countryCode: "SI";
  cityId: string;
  factKey: "si-city-safety";
  definitionId: "si-municipal-police-offences-per-100000@1";
}>;

export type CitySourceBindingCursorV1 =
  | Readonly<{ schemaVersion: "city-source-binding-cursor@1"; kind: "installed"; installedBindingDigest: string }>
  | Readonly<{ schemaVersion: "city-source-binding-cursor@1"; kind: "override"; revisionId: string; revisionOrdinal: number }>;

export type CitySourceVersionV1 = Readonly<{
  schemaVersion: "source-version@1"; id: string; bindingKey: CitySourceBindingKeyV1;
  publisherId: string; navigationUrl: string; requestedUrl: string; finalUrl: string;
  captureArtifactIds: readonly string[]; captureSha256: readonly string[]; evidenceSnapshotId: string;
  parserVersion: string; capturedAt: string;
}>;

export type CitySourceBindingRevisionV1 = Readonly<{
  schemaVersion: "source-binding@1"; id: string; bindingKey: CitySourceBindingKeyV1;
  revisionOrdinal: number; predecessorRevisionId: string | null; sourceVersionId: string;
  evidenceSnapshotId: string; knowledgeRevisionId: string; frontierRevisionId: string;
  policyVersion: "official-source-recovery@1"; actor: "local_codex_recovery"; parentRunId: string; createdAt: string;
}>;

export type OfficialSourceRecoveryAttemptV1 = Readonly<{
  schemaVersion: "official-source-recovery-attempt@1"; id: string; commandId: string;
  bindingKey: CitySourceBindingKeyV1; cursor: CitySourceBindingCursorV1; outcome: "yellow" | "replaced";
  createdAt: string;
}>;

export type OfficialSourceReplacedEventV1 = Readonly<{
  schemaVersion: "official-source-replaced@1"; id: string; commandId: string;
  bindingKey: CitySourceBindingKeyV1; revisionId: string; createdAt: string;
}>;

export type CitySourceReplacementInput = Readonly<{
  commandId: string; sourceVersion: CitySourceVersionV1; revision: CitySourceBindingRevisionV1; attempt: OfficialSourceRecoveryAttemptV1;
}>;

const HEX = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;

function mismatch(): never { throw new Error("integrity_mismatch"); }
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) mismatch();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null || Object.getOwnPropertySymbols(value).length !== 0) mismatch();
  return value as Record<string, unknown>;
}
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const input = record(value); const names = Object.getOwnPropertyNames(input);
  if (names.length !== keys.length || !keys.every((key) => names.includes(key))) mismatch();
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(input, key); if (descriptor?.enumerable !== true || !("value" in descriptor)) mismatch(); }
  return input;
}
function text(value: unknown): string { if (typeof value !== "string" || value.length === 0 || !IDENTIFIER.test(value)) mismatch(); return value; }
function url(value: unknown): string { try { return canonicalHttpsUrl(value); } catch { return mismatch(); } }
function instant(value: unknown): string { if (typeof value !== "string" || new Date(value).toISOString() !== value) mismatch(); return value; }
function ordinal(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) mismatch(); return value; }
function digest(value: unknown): string { if (typeof value !== "string" || !HEX.test(value)) mismatch(); return value; }
function strings(value: unknown, validator: (item: unknown) => string): readonly string[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length !== 0 || Object.getOwnPropertyNames(value).length !== value.length + 1) mismatch();
  const copy: string[] = []; for (let index = 0; index < value.length; index += 1) { const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (descriptor?.enumerable !== true || !("value" in descriptor)) mismatch(); copy.push(validator(descriptor.value)); } return Object.freeze(copy);
}
function freeze<T>(value: T): T { if (value !== null && typeof value === "object") { for (const key of Object.getOwnPropertyNames(value)) freeze((value as Record<string, unknown>)[key]); Object.freeze(value); } return value; }

export function reconstructCitySourceBindingKeyV1(value: unknown): CitySourceBindingKeyV1 {
  const input = fields(value, ["schemaVersion", "countryCode", "cityId", "factKey", "definitionId"]);
  if (input.schemaVersion !== "city-source-binding-key@1" || input.countryCode !== "SI" || input.factKey !== "si-city-safety" || input.definitionId !== "si-municipal-police-offences-per-100000@1") mismatch();
  return freeze({ schemaVersion: input.schemaVersion, countryCode: input.countryCode, cityId: text(input.cityId), factKey: input.factKey, definitionId: input.definitionId });
}
export function reconstructCitySourceBindingCursorV1(value: unknown): CitySourceBindingCursorV1 {
  const input = record(value);
  if (input.schemaVersion !== "city-source-binding-cursor@1") mismatch();
  if (input.kind === "installed") { fields(input, ["schemaVersion", "kind", "installedBindingDigest"]); return freeze({ schemaVersion: input.schemaVersion, kind: input.kind, installedBindingDigest: digest(input.installedBindingDigest) }); }
  if (input.kind === "override") { fields(input, ["schemaVersion", "kind", "revisionId", "revisionOrdinal"]); return freeze({ schemaVersion: input.schemaVersion, kind: input.kind, revisionId: text(input.revisionId), revisionOrdinal: ordinal(input.revisionOrdinal) }); }
  return mismatch();
}
export function reconstructCitySourceVersionV1(value: unknown): CitySourceVersionV1 {
  const input = fields(value, ["schemaVersion", "id", "bindingKey", "publisherId", "navigationUrl", "requestedUrl", "finalUrl", "captureArtifactIds", "captureSha256", "evidenceSnapshotId", "parserVersion", "capturedAt"]);
  if (input.schemaVersion !== "source-version@1") mismatch();
  const artifacts = strings(input.captureArtifactIds, text), hashes = strings(input.captureSha256, digest);
  if (artifacts.length === 0 || artifacts.length !== hashes.length) mismatch();
  return freeze({ schemaVersion: input.schemaVersion, id: text(input.id), bindingKey: reconstructCitySourceBindingKeyV1(input.bindingKey), publisherId: text(input.publisherId), navigationUrl: url(input.navigationUrl), requestedUrl: url(input.requestedUrl), finalUrl: url(input.finalUrl), captureArtifactIds: artifacts, captureSha256: hashes, evidenceSnapshotId: text(input.evidenceSnapshotId), parserVersion: text(input.parserVersion), capturedAt: instant(input.capturedAt) });
}
export function reconstructCitySourceBindingRevisionV1(value: unknown): CitySourceBindingRevisionV1 {
  const input = fields(value, ["schemaVersion", "id", "bindingKey", "revisionOrdinal", "predecessorRevisionId", "sourceVersionId", "evidenceSnapshotId", "knowledgeRevisionId", "frontierRevisionId", "policyVersion", "actor", "parentRunId", "createdAt"]);
  if (input.schemaVersion !== "source-binding@1" || input.policyVersion !== "official-source-recovery@1" || input.actor !== "local_codex_recovery" || (input.predecessorRevisionId !== null && typeof input.predecessorRevisionId !== "string")) mismatch();
  return freeze({ schemaVersion: input.schemaVersion, id: text(input.id), bindingKey: reconstructCitySourceBindingKeyV1(input.bindingKey), revisionOrdinal: ordinal(input.revisionOrdinal), predecessorRevisionId: input.predecessorRevisionId === null ? null : text(input.predecessorRevisionId), sourceVersionId: text(input.sourceVersionId), evidenceSnapshotId: text(input.evidenceSnapshotId), knowledgeRevisionId: text(input.knowledgeRevisionId), frontierRevisionId: text(input.frontierRevisionId), policyVersion: input.policyVersion, actor: input.actor, parentRunId: text(input.parentRunId), createdAt: instant(input.createdAt) });
}
export function reconstructOfficialSourceRecoveryAttemptV1(value: unknown): OfficialSourceRecoveryAttemptV1 {
  const input = fields(value, ["schemaVersion", "id", "commandId", "bindingKey", "cursor", "outcome", "createdAt"]); if (input.schemaVersion !== "official-source-recovery-attempt@1" || (input.outcome !== "yellow" && input.outcome !== "replaced")) mismatch();
  return freeze({ schemaVersion: input.schemaVersion, id: text(input.id), commandId: text(input.commandId), bindingKey: reconstructCitySourceBindingKeyV1(input.bindingKey), cursor: reconstructCitySourceBindingCursorV1(input.cursor), outcome: input.outcome, createdAt: instant(input.createdAt) });
}
export function reconstructOfficialSourceReplacedEventV1(value: unknown): OfficialSourceReplacedEventV1 {
  const input = fields(value, ["schemaVersion", "id", "commandId", "bindingKey", "revisionId", "createdAt"]); if (input.schemaVersion !== "official-source-replaced@1") mismatch();
  return freeze({ schemaVersion: input.schemaVersion, id: text(input.id), commandId: text(input.commandId), bindingKey: reconstructCitySourceBindingKeyV1(input.bindingKey), revisionId: text(input.revisionId), createdAt: instant(input.createdAt) });
}
export function reconstructCitySourceReplacementInputV1(value: unknown): CitySourceReplacementInput {
  const input = fields(value, ["commandId", "sourceVersion", "revision", "attempt"]);
  return freeze({ commandId: text(input.commandId), sourceVersion: reconstructCitySourceVersionV1(input.sourceVersion), revision: reconstructCitySourceBindingRevisionV1(input.revision), attempt: reconstructOfficialSourceRecoveryAttemptV1(input.attempt) });
}
