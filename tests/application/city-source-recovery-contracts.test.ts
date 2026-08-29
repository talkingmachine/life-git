import { describe, expect, test } from "vitest";

import {
  reconstructCitySourceBindingRevisionV1,
  reconstructCitySourceBindingCursorV1,
  reconstructCitySourceReplacementInputV1,
  reconstructCitySourceVersionV1,
  reconstructOfficialSourceRecoveryAttemptV1,
} from "../../src/application/city-source-recovery-contracts";

describe("city source recovery contracts", () => {
  test("owns and recursively freezes an installed cursor", () => {
    const borrowed = {
      schemaVersion: "city-source-binding-cursor@1",
      kind: "installed",
      installedBindingDigest: "a".repeat(64),
    };

    const cursor = reconstructCitySourceBindingCursorV1(borrowed);
    borrowed.installedBindingDigest = "b".repeat(64);

    expect(cursor).toEqual({
      schemaVersion: "city-source-binding-cursor@1",
      kind: "installed",
      installedBindingDigest: "a".repeat(64),
    });
    expect(Object.isFrozen(cursor)).toBe(true);
  });

  test("accepts revision ordinal 999 without accepting an unknown contract schema", () => {
    const version = reconstructCitySourceVersionV1({
      schemaVersion: "source-version@1",
      id: "source-version:999",
      bindingKey: {
        schemaVersion: "city-source-binding-key@1",
        countryCode: "SI",
        cityId: "ljubljana",
        factKey: "si-city-safety",
        definitionId: "si-municipal-police-offences-per-100000@1",
      },
      publisherId: "slovenian-police",
      navigationUrl: "https://www.policija.si/",
      requestedUrl: "https://www.policija.si/statistics",
      finalUrl: "https://www.policija.si/statistics",
      captureArtifactIds: ["artifact:999"],
      captureSha256: ["a".repeat(64)],
      evidenceSnapshotId: "evidence:999",
      parserVersion: "city-safety-parser@1",
      capturedAt: "2026-08-29T12:00:00.000Z",
    });
    expect(version.id).toBe("source-version:999");
    expect(() => reconstructCitySourceVersionV1({ ...version, schemaVersion: "source-version@999" })).toThrow("integrity_mismatch");
  });

  test("rejects unsafe URLs and non-data capture arrays", () => {
    const value = { schemaVersion: "source-version@1", id: "source:one", bindingKey: { schemaVersion: "city-source-binding-key@1", countryCode: "SI", cityId: "ljubljana", factKey: "si-city-safety", definitionId: "si-municipal-police-offences-per-100000@1" }, publisherId: "policija", navigationUrl: "https://www.policija.si/#fragment", requestedUrl: "https://www.policija.si/statistics", finalUrl: "https://www.policija.si/statistics", captureArtifactIds: ["artifact:one"], captureSha256: ["a".repeat(64)], evidenceSnapshotId: "evidence:one", parserVersion: "parser@1", capturedAt: "2026-08-29T12:00:00.000Z" };
    expect(() => reconstructCitySourceVersionV1(value)).toThrow("integrity_mismatch");
    value.navigationUrl = "https://www.policija.si/";
    const sparse = new Array(1); value.captureArtifactIds = sparse as unknown as string[];
    expect(() => reconstructCitySourceVersionV1(value)).toThrow("integrity_mismatch");
  });

  test("owns replacement input and rejects a proxy", () => {
    const source = reconstructCitySourceVersionV1({ schemaVersion: "source-version@1", id: "source:one", bindingKey: { schemaVersion: "city-source-binding-key@1", countryCode: "SI", cityId: "ljubljana", factKey: "si-city-safety", definitionId: "si-municipal-police-offences-per-100000@1" }, publisherId: "policija", navigationUrl: "https://www.policija.si/", requestedUrl: "https://www.policija.si/statistics", finalUrl: "https://www.policija.si/statistics", captureArtifactIds: ["artifact:one"], captureSha256: ["a".repeat(64)], evidenceSnapshotId: "evidence:one", parserVersion: "parser@1", capturedAt: "2026-08-29T12:00:00.000Z" });
    const revision = reconstructCitySourceBindingRevisionV1({ schemaVersion: "source-binding@1", id: "binding:one", bindingKey: source.bindingKey, revisionOrdinal: 1, predecessorRevisionId: null, sourceVersionId: source.id, evidenceSnapshotId: source.evidenceSnapshotId, knowledgeRevisionId: "knowledge:one", frontierRevisionId: "frontier:one", policyVersion: "official-source-recovery@1", actor: "local_codex_recovery", parentRunId: "run:one", createdAt: "2026-08-29T12:01:00.000Z" });
    const attempt = reconstructOfficialSourceRecoveryAttemptV1({ schemaVersion: "official-source-recovery-attempt@1", id: "attempt:one", commandId: "command:one", bindingKey: source.bindingKey, cursor: { schemaVersion: "city-source-binding-cursor@1", kind: "installed", installedBindingDigest: "a".repeat(64) }, outcome: "replaced", createdAt: "2026-08-29T12:01:00.000Z" });
    const borrowed = { commandId: attempt.commandId, sourceVersion: source, revision, attempt };
    const owned = reconstructCitySourceReplacementInputV1(borrowed);
    borrowed.commandId = "command:changed";
    expect(owned.commandId).toBe("command:one");
    expect(owned.sourceVersion).not.toBe(source);
    expect(Object.isFrozen(owned)).toBe(true);
    expect(Object.isFrozen(owned.sourceVersion.captureArtifactIds)).toBe(true);
    expect(() => reconstructCitySourceReplacementInputV1(new Proxy(borrowed, {}))).toThrow("integrity_mismatch");
  });
});
