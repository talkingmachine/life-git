import { expect, expectTypeOf, test } from "vitest";
import type Database from "better-sqlite3";

import type {
  AdministrativeCapturedArtifact,
  ArtifactBytes,
  CapturedEntry,
  Claim,
  EvidenceOrigin,
  LiveCapturedArtifact,
  ParserEntry,
} from "../../src/research/contracts";
import type {
  AdministrativeArtifactProvenance,
  AdministrativeTerminalEvidenceEntry,
  EvidenceArtifactProvenance,
  EvidenceIntegrity,
  EvidenceManifest,
  EvidenceWriteStore,
  SealEvidenceInput,
  SealedEvidence,
  TerminalEvidenceEntry,
  TerminalEvidenceEntryForOrigin,
} from "../../src/research/research-plan";
import {
  insertSealedEvidence,
  verifySealedEvidenceForInsert,
} from "../../src/infrastructure/sqlite/evidence-store";
// @ts-expect-error Stored SQLite row unions must remain module-private.
import type { StoredArtifactRow } from "../../src/infrastructure/sqlite/evidence-store";

type TestSourceId = "administrative-test";
type TestClaim = Claim<{ readonly present: true }, TestSourceId>;

declare const liveArtifact: LiveCapturedArtifact<TestSourceId>;
declare const administrativeArtifact: AdministrativeCapturedArtifact<TestSourceId>;
declare const liveTerminalEntry: TerminalEvidenceEntry<TestSourceId, TestClaim>;
declare const administrativeTerminalEntry: AdministrativeTerminalEvidenceEntry<
  TestSourceId,
  TestClaim
>;
declare const liveSealed: SealedEvidence<TestSourceId, TestClaim>;
declare const administrativeSealed: SealedEvidence<
  TestSourceId,
  TestClaim,
  "administrative"
>;
declare const liveStore: EvidenceWriteStore<TestSourceId, TestClaim>;
declare const administrativeStore: EvidenceWriteStore<
  TestSourceId,
  TestClaim,
  "administrative"
>;
declare const integrity: EvidenceIntegrity;
declare const database: Database.Database;
void (undefined as unknown as StoredArtifactRow);

test("legacy Evidence type arguments remain live-only while administrative use is explicit", () => {
  expectTypeOf<ArtifactBytes["url"]>().toEqualTypeOf<string>();
  expectTypeOf<ParserEntry<TestSourceId>["artifacts"][number]["url"]>()
    .toEqualTypeOf<string>();
  expectTypeOf<EvidenceManifest<TestSourceId, TestClaim>>()
    .toEqualTypeOf<EvidenceManifest<TestSourceId, TestClaim, "live">>();
  expectTypeOf<SealedEvidence<TestSourceId, TestClaim>>()
    .toEqualTypeOf<SealedEvidence<TestSourceId, TestClaim, "live">>();
  expectTypeOf<EvidenceWriteStore<TestSourceId, TestClaim>>()
    .toEqualTypeOf<EvidenceWriteStore<TestSourceId, TestClaim, "live">>();
  expectTypeOf<EvidenceArtifactProvenance<TestSourceId>>()
    .toEqualTypeOf<EvidenceArtifactProvenance<TestSourceId, "live">>();
  expectTypeOf<TerminalEvidenceEntryForOrigin<TestSourceId, TestClaim>>()
    .toEqualTypeOf<TerminalEvidenceEntryForOrigin<TestSourceId, TestClaim, "live">>();
  expectTypeOf<TerminalEvidenceEntry<TestSourceId, TestClaim>>()
    .toEqualTypeOf<TerminalEvidenceEntryForOrigin<TestSourceId, TestClaim, "live">>();
  expectTypeOf<SealEvidenceInput<TestSourceId, TestClaim>>()
    .toEqualTypeOf<SealEvidenceInput<TestSourceId, TestClaim, "live">>();

  if (false) {
    const missingUrl: ArtifactBytes = {
      artifactId: "artifact",
      role: "role",
      mediaType: "application/octet-stream",
      sha256: "a".repeat(64),
      bytes: Uint8Array.of(1),
      // @ts-expect-error ArtifactBytes remains URL-bearing.
      url: undefined,
    };
    void missingUrl;

    const liveCapturedEntry: CapturedEntry<TestSourceId> = {
      sourceId: "administrative-test",
      navigationUrl: "https://official.example/source",
      resolvedEvidenceUrl: "https://official.example/source",
      // @ts-expect-error Generic replay remains closed to administrative artifacts.
      artifacts: [administrativeArtifact],
    };
    void liveCapturedEntry;

    // @ts-expect-error Administrative artifacts cannot enter the default live store.
    void liveStore.appendArtifact(administrativeArtifact);
    // @ts-expect-error Live artifacts cannot enter the explicit administrative store.
    void administrativeStore.appendArtifact(liveArtifact);
    const defaultInput: SealEvidenceInput<TestSourceId, TestClaim> = {
      id: "evidence",
      assessmentDate: "2026-08-24",
      // @ts-expect-error Administrative terminal entries cannot enter the default live seal input.
      entries: [administrativeTerminalEntry],
      sourceIds: ["administrative-test"],
      parserVersions: { "administrative-test": "parser@1" },
      rulesVersion: "rules@1",
    };
    void defaultInput;
    const administrativeInput: SealEvidenceInput<TestSourceId, TestClaim, "administrative"> = {
      id: "evidence",
      assessmentDate: "2026-08-24",
      // @ts-expect-error A live terminal entry cannot enter an administrative seal input.
      entries: [liveTerminalEntry],
      sourceIds: ["administrative-test"],
      parserVersions: { "administrative-test": "parser@1" },
      rulesVersion: "rules@1",
    };
    void administrativeInput;
    // @ts-expect-error An administrative bundle cannot enter a default live seal API.
    void liveStore.seal(administrativeSealed);
    // @ts-expect-error A live bundle cannot enter the explicit administrative seal API.
    void administrativeStore.seal(liveSealed);
    // @ts-expect-error The exported legacy insert remains live-only.
    void insertSealedEvidence(database, administrativeSealed, integrity);
  }

  const verifyForOrigin = <O extends EvidenceOrigin>(
    sealed: SealedEvidence<TestSourceId, TestClaim, O>,
  ): void => verifySealedEvidenceForInsert(sealed, integrity);
  expectTypeOf(verifyForOrigin).parameter(0).toMatchTypeOf<
    SealedEvidence<TestSourceId, TestClaim, EvidenceOrigin>
  >();
  expectTypeOf<AdministrativeArtifactProvenance<TestSourceId>["producer"]>()
    .toEqualTypeOf<string>();
  expectTypeOf<AdministrativeCapturedArtifact<TestSourceId>>().not.toHaveProperty("url");
  expect(true).toBe(true);
});
