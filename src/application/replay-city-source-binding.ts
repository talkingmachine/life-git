import { replayCityEvidence } from "./replay-city-evidence";
import type { CityEvidenceReplayPorts, VerifiedCityEvidence } from "./city-data-contracts";
import type { HistoricalCitySourceBinding } from "./city-source-recovery";
import { types } from "node:util";
import { reconstructCitySourceBindingKeyV1, reconstructCitySourceBindingRevisionV1, reconstructCitySourceVersionV1, type CitySourceBindingKeyV1 } from "./city-source-recovery-contracts";

export type HistoricalCitySourceReplayPort = Readonly<{
  loadRevisionVerified(bindingKey: CitySourceBindingKeyV1, revisionId: string): HistoricalCitySourceBinding;
}>;

export type HistoricalCitySourceReplay = Readonly<{
  binding: HistoricalCitySourceBinding;
  evidence: VerifiedCityEvidence;
}>;

/** Replays one immutable source-binding revision; it has no effective-binding, discovery or network seam. */
export async function replayHistoricalCitySourceBinding(
  input: Readonly<{ bindingKey: CitySourceBindingKeyV1; revisionId: string; packageId: string }>,
  ports: Readonly<{ bindings: HistoricalCitySourceReplayPort; evidenceReplay: CityEvidenceReplayPorts }>,
): Promise<HistoricalCitySourceReplay> {
  const ownedInput = exact(input, ["bindingKey", "revisionId", "packageId"]);
  const bindingKey = reconstructCitySourceBindingKeyV1(ownedInput.bindingKey);
  if (!identifier(ownedInput.revisionId) || !identifier(ownedInput.packageId)) mismatch();
  const capturedPorts = exact(ports, ["bindings", "evidenceReplay"]);
  const evidenceReplay = captureEvidenceReplayPorts(capturedPorts.evidenceReplay);
  const bindingReceiver = capturedPorts.bindings;
  const bindings = exact(bindingReceiver, ["loadRevisionVerified"]);
  if (typeof bindings.loadRevisionVerified !== "function" || types.isProxy(bindings.loadRevisionVerified)) mismatch();
  let borrowed: unknown;
  try { borrowed = Reflect.apply(bindings.loadRevisionVerified as HistoricalCitySourceReplayPort["loadRevisionVerified"], bindingReceiver, [bindingKey, ownedInput.revisionId]); }
  catch { mismatch(); }
  const rawBinding = exact(borrowed, ["bindingKey", "revision", "sourceVersion"]);
  const binding = Object.freeze({ bindingKey: reconstructCitySourceBindingKeyV1(rawBinding.bindingKey),
    revision: reconstructCitySourceBindingRevisionV1(rawBinding.revision), sourceVersion: reconstructCitySourceVersionV1(rawBinding.sourceVersion) });
  if (binding.revision.id !== ownedInput.revisionId || binding.revision.sourceVersionId !== binding.sourceVersion.id ||
    !sameKey(binding.bindingKey, bindingKey) || !sameKey(binding.revision.bindingKey, bindingKey) || !sameKey(binding.sourceVersion.bindingKey, bindingKey) ||
    binding.revision.evidenceSnapshotId !== binding.sourceVersion.evidenceSnapshotId) mismatch();
  const evidence = await replayCityEvidence({ evidenceSnapshotId: binding.sourceVersion.evidenceSnapshotId, cityId: bindingKey.cityId, packageId: ownedInput.packageId }, evidenceReplay);
  const result = evidence.snapshot.safetyAttemptLedger.result;
  const accepted = result.kind === "verified" ? evidence.snapshot.safetyAttemptLedger.candidates[result.acceptedCandidateIndex] : undefined;
  const entries = evidence.genericEvidence.entries.filter((entry) => entry.sourceId === "si-city-safety");
  if (accepted === undefined || accepted.origin.kind === "previous" || accepted.disposition !== "usable" || accepted.periodDisposition !== "preferred" || entries.length !== 1 ||
    evidence.snapshot.cityId !== bindingKey.cityId || evidence.snapshot.countryCode !== bindingKey.countryCode ||
    evidence.snapshot.definitionIds.safety !== bindingKey.definitionId || evidence.snapshot.id !== binding.sourceVersion.evidenceSnapshotId ||
    accepted.publisherId !== binding.sourceVersion.publisherId || accepted.publisherNavigationUrl !== binding.sourceVersion.navigationUrl ||
    accepted.canonicalUrl !== binding.sourceVersion.requestedUrl || accepted.resolvedEvidenceUrl !== binding.sourceVersion.finalUrl ||
    evidence.genericEvidence.snapshot.parserVersions["si-city-safety"] !== binding.sourceVersion.parserVersion ||
    evidence.snapshot.completedAt !== binding.sourceVersion.capturedAt ||
    entries[0]!.artifacts.length !== binding.sourceVersion.captureArtifactIds.length ||
    entries[0]!.artifacts.some((artifact, index) => artifact.artifactId !== binding.sourceVersion.captureArtifactIds[index] || artifact.sha256 !== binding.sourceVersion.captureSha256[index])) mismatch();
  return Object.freeze({ binding, evidence });
}

function mismatch(): never { throw new Error("integrity_mismatch"); }
function identifier(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value); }
function sameKey(left: CitySourceBindingKeyV1, right: CitySourceBindingKeyV1): boolean { return left.countryCode === right.countryCode && left.cityId === right.cityId && left.factKey === right.factKey && left.definitionId === right.definitionId; }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) mismatch();
  const descriptors = Object.getOwnPropertyDescriptors(value); const names = Object.keys(descriptors);
  if (names.length !== keys.length || !keys.every((key) => names.includes(key))) mismatch();
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of keys) { const descriptor = descriptors[key]; if (descriptor?.enumerable !== true || !("value" in descriptor)) mismatch(); copy[key] = descriptor.value; }
  return copy;
}

function captureEvidenceReplayPorts(value: unknown): CityEvidenceReplayPorts {
  const root = exact(value, ["read", "integrity", "package"]);
  const readReceiver = root.read; const read = exact(readReceiver, ["loadVerified", "findVerifiedByCheckRunId"]);
  const integrityReceiver = root.integrity; const integrity = exact(integrityReceiver, ["canonical", "hash", "hashBytes"]);
  const packageReceiver = root.package; const packagePort = exact(packageReceiver, ["loadExactReplayContract"]);
  const loadVerified = callable(read.loadVerified) as CityEvidenceReplayPorts["read"]["loadVerified"];
  const findVerifiedByCheckRunId = callable(read.findVerifiedByCheckRunId) as CityEvidenceReplayPorts["read"]["findVerifiedByCheckRunId"];
  const canonical = callable(integrity.canonical) as CityEvidenceReplayPorts["integrity"]["canonical"];
  const hash = callable(integrity.hash) as CityEvidenceReplayPorts["integrity"]["hash"];
  const hashBytes = callable(integrity.hashBytes) as CityEvidenceReplayPorts["integrity"]["hashBytes"];
  const loadExactReplayContract = callable(packagePort.loadExactReplayContract) as CityEvidenceReplayPorts["package"]["loadExactReplayContract"];
  return Object.freeze({
    read: Object.freeze({
      loadVerified: (...args: Parameters<CityEvidenceReplayPorts["read"]["loadVerified"]>) => Reflect.apply(loadVerified, readReceiver, args) as ReturnType<CityEvidenceReplayPorts["read"]["loadVerified"]>,
      findVerifiedByCheckRunId: (...args: Parameters<CityEvidenceReplayPorts["read"]["findVerifiedByCheckRunId"]>) => Reflect.apply(findVerifiedByCheckRunId, readReceiver, args) as ReturnType<CityEvidenceReplayPorts["read"]["findVerifiedByCheckRunId"]>,
    }),
    integrity: Object.freeze({
      canonical: (...args: Parameters<CityEvidenceReplayPorts["integrity"]["canonical"]>) => Reflect.apply(canonical, integrityReceiver, args) as ReturnType<CityEvidenceReplayPorts["integrity"]["canonical"]>,
      hash: (...args: Parameters<CityEvidenceReplayPorts["integrity"]["hash"]>) => Reflect.apply(hash, integrityReceiver, args) as ReturnType<CityEvidenceReplayPorts["integrity"]["hash"]>,
      hashBytes: (...args: Parameters<CityEvidenceReplayPorts["integrity"]["hashBytes"]>) => Reflect.apply(hashBytes, integrityReceiver, args) as ReturnType<CityEvidenceReplayPorts["integrity"]["hashBytes"]>,
    }),
    package: Object.freeze({
      loadExactReplayContract: (...args: Parameters<CityEvidenceReplayPorts["package"]["loadExactReplayContract"]>) => Reflect.apply(loadExactReplayContract, packageReceiver, args) as ReturnType<CityEvidenceReplayPorts["package"]["loadExactReplayContract"]>,
    }),
  });
}

function callable(value: unknown): (...args: unknown[]) => unknown {
  if (typeof value !== "function" || types.isProxy(value)) mismatch();
  return value as (...args: unknown[]) => unknown;
}
