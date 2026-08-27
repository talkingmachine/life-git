import { describe, expect, test } from "vitest";

import {
  applyQuestionnaireFieldChange,
  confirmOnboardingValues,
  createOnboardingDraft,
  materializeOnboardingSnapshots,
  reconstructOnboardingDraft,
  rehydrateOnboardingDraft,
  reviewQuestionnaire,
  type OnboardingDraft,
  type OnboardingFieldId,
} from "../../src/decision/onboarding-questionnaire";
import { reconstructQuestionnaireProvenance } from "../../src/decision/onboarding-provenance";
import { CITY_PREFERENCE_IDS, COUNTRY_PREFERENCE_IDS } from "../../src/decision/onboarding-catalog";

const SELF_ID = "00000000-0000-4000-8000-000000000001";
const SPOUSE_ID = "00000000-0000-4000-8000-000000000002";
const CHILD_ID = "00000000-0000-4000-8000-000000000003";

function field(draft: OnboardingDraft, fieldId: OnboardingFieldId) {
  const result = draft.fields.find((candidate) => candidate.fieldId === fieldId);
  if (result === undefined) throw new Error(`missing ${fieldId}`);
  return result;
}

function manual(draft: OnboardingDraft, fieldId: OnboardingFieldId, rawInput: unknown) {
  return applyQuestionnaireFieldChange(draft, { kind: "manual_set", fieldId, rawInput });
}

function model(draft: OnboardingDraft, fieldId: OnboardingFieldId, normalizedValue: never) {
  return applyQuestionnaireFieldChange(draft, {
    kind: "guarded_model_set",
    fieldId,
    normalizedValue,
  });
}

function completeDraft(): OnboardingDraft {
  let draft = createOnboardingDraft(() => SELF_ID);
  draft = manual(draft, "current_location", { countryCode: "RU", city: "Moscow" });
  draft = manual(draft, "move_horizon", "within_3_months");
  draft = manual(draft, "moving_party", "alone");
  draft = manual(draft, "savings", { min: "0", max: "10000", currency: "EUR" });
  draft = manual(draft, `participants.${SELF_ID}.citizenships`, ["RU"]);
  draft = manual(draft, `participants.${SELF_ID}.passport`, "absent");
  draft = manual(draft, `participants.${SELF_ID}.current_work`, { status: "not_working" });
  draft = manual(draft, `participants.${SELF_ID}.monthly_income`, {
    amount: "0",
    currency: "RUB",
    basis: "net",
  });
  draft = manual(draft, `participants.${SELF_ID}.education`, { level: "none" });
  draft = manual(draft, `participants.${SELF_ID}.relevant_experience_years`, 0);

  for (const criterionId of COUNTRY_PREFERENCE_IDS) {
    draft = manual(draft, `country_preferences.${criterionId}.mode`, "required");
    draft = manual(draft, `country_preferences.${criterionId}.importance`, 3);
    draft = manual(draft, `country_preferences.${criterionId}.target`, "required_true");
  }
  for (const criterionId of CITY_PREFERENCE_IDS) {
    draft = manual(draft, `city_preferences.${criterionId}.mode`, "weighted");
    draft = manual(draft, `city_preferences.${criterionId}.importance`, 3);
    draft = manual(draft, `city_preferences.${criterionId}.target`, `${criterionId}-target`);
  }
  return draft;
}

describe("onboarding questionnaire", () => {
  test("creates the exact canonical catalog with one stable structural self", () => {
    const draft = createOnboardingDraft(() => SELF_ID);

    expect(draft.schemaVersion).toBe("onboarding-draft@1");
    expect(draft.fields.map(({ fieldId }) => fieldId)).toEqual([
      "current_location",
      "move_horizon",
      "moving_party",
      "participants",
      "savings",
      ...[
        "citizenships",
        "passport",
        "current_work",
        "remote_continuation",
        "monthly_income",
        "education",
        "relevant_experience_years",
      ].map((leaf) => `participants.${SELF_ID}.${leaf}`),
      ...COUNTRY_PREFERENCE_IDS.flatMap((id) => ["mode", "importance", "target"].map(
        (part) => `country_preferences.${id}.${part}`,
      )),
      ...CITY_PREFERENCE_IDS.flatMap((id) => ["mode", "importance", "target"].map(
        (part) => `city_preferences.${id}.${part}`,
      )),
    ]);
    expect(field(draft, "participants")).toEqual({
      fieldId: "participants",
      applicability: "required",
      rawInput: null,
      normalizedValue: [{ participantId: SELF_ID, relationship: "self" }],
      origin: "manual",
      overwrite: null,
    });
    expect(Object.isFrozen(draft)).toBe(true);
    expect(Object.isFrozen(draft.fields)).toBe(true);
    for (const invalidParticipantId of [
      "00000000-0000-0000-0000-000000000000",
      "00000000-0000-9000-8000-000000000001",
      "00000000-0000-4000-7000-000000000001",
      "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF",
    ]) {
      expect(() => createOnboardingDraft(() => invalidParticipantId)).toThrow(TypeError);
    }
  });

  test("reconciles roster order and every participant applicability transition", () => {
    let draft = createOnboardingDraft(() => SELF_ID);
    draft = manual(draft, "moving_party", "with_companions");
    draft = manual(draft, "participants", [
      { participantId: SELF_ID, relationship: "self" },
      { participantId: SPOUSE_ID, relationship: "spouse" },
      { participantId: CHILD_ID, relationship: "other_family" },
    ]);
    draft = manual(draft, `participants.${SPOUSE_ID}.current_work`, {
      status: "employment",
      occupation: "Engineer",
    });
    draft = manual(draft, `participants.${SPOUSE_ID}.remote_continuation`, "yes");
    draft = manual(draft, `participants.${CHILD_ID}.monthly_income`, {
      amount: "0",
      currency: "EUR",
      basis: "net",
    });

    expect(field(draft, `participants.${SPOUSE_ID}.remote_continuation`).applicability).toBe("required");
    expect(field(draft, `participants.${CHILD_ID}.monthly_income`).normalizedValue).toEqual({
      amount: "0",
      currency: "EUR",
      basis: "net",
    });

    draft = manual(draft, "participants", [
      { participantId: SELF_ID, relationship: "self" },
      { participantId: SPOUSE_ID, relationship: "spouse" },
      { participantId: CHILD_ID, relationship: "minor_child" },
    ]);
    expect(field(draft, `participants.${CHILD_ID}.citizenships`).applicability).toBe("required");
    expect(field(draft, `participants.${CHILD_ID}.passport`).applicability).toBe("required");
    expect(field(draft, `participants.${CHILD_ID}.monthly_income`)).toMatchObject({
      applicability: "not_applicable",
      rawInput: null,
      normalizedValue: null,
      origin: "empty",
      overwrite: null,
    });

    draft = manual(draft, `participants.${SPOUSE_ID}.current_work`, { status: "not_working" });
    expect(field(draft, `participants.${SPOUSE_ID}.remote_continuation`)).toMatchObject({
      applicability: "not_applicable",
      normalizedValue: null,
      origin: "empty",
      overwrite: null,
    });

    draft = manual(draft, "participants", [
      { participantId: SELF_ID, relationship: "self" },
      { participantId: SPOUSE_ID, relationship: "spouse" },
    ]);
    expect(draft.fields.some(({ fieldId }) => fieldId.includes(CHILD_ID))).toBe(false);
    expect(field(draft, "participants").normalizedValue).toEqual([
      { participantId: SELF_ID, relationship: "self" },
      { participantId: SPOUSE_ID, relationship: "spouse" },
    ]);
  });

  test("keeps placeholder and malformed manual input visible while accepting explicit zero", () => {
    let draft = createOnboardingDraft(() => SELF_ID);
    draft = manual(draft, "current_location", "");
    draft = manual(draft, "move_horizon", "не знаю");
    draft = manual(draft, "savings", "broken");
    draft = manual(draft, `participants.${SELF_ID}.monthly_income`, {
      amount: "0",
      currency: "EUR",
      basis: "net",
    });
    draft = manual(draft, `participants.${SELF_ID}.relevant_experience_years`, 0);

    expect(field(draft, "move_horizon")).toMatchObject({
      rawInput: "не знаю",
      normalizedValue: null,
      origin: "empty",
    });
    expect(field(draft, `participants.${SELF_ID}.monthly_income`).normalizedValue).toMatchObject({ amount: "0" });
    expect(field(draft, `participants.${SELF_ID}.relevant_experience_years`).normalizedValue).toBe(0);
    expect(reviewQuestionnaire(draft).issues.slice(0, 3)).toEqual([
      { fieldId: "current_location", reasonCode: "required_empty" },
      { fieldId: "move_horizon", reasonCode: "placeholder_value" },
      { fieldId: "moving_party", reasonCode: "required_empty" },
    ]);
    expect(reviewQuestionnaire(draft).issues).toContainEqual({
      fieldId: "savings",
      reasonCode: "invalid_value",
    });
  });

  test("keeps the original manual value through repeated yellow proposals and supports Confirm or Revert", () => {
    let draft = completeDraft();
    draft = manual(draft, "current_location", { countryCode: "RU", city: "Kazan" });
    draft = model(draft, "current_location", { countryCode: "RS", city: "Belgrade" } as never);
    draft = model(draft, "current_location", { countryCode: "SI", city: "Ljubljana" } as never);

    expect(field(draft, "current_location")).toMatchObject({
      origin: "model",
      normalizedValue: { countryCode: "SI", city: "Ljubljana" },
      overwrite: {
        previousValue: { countryCode: "RU", city: "Kazan" },
        proposedValue: { countryCode: "SI", city: "Ljubljana" },
        reasonCode: "explicit_new_information",
        reviewState: "model_overwrite_unreviewed",
      },
    });
    expect(reviewQuestionnaire(draft)).toEqual({ kind: "ready", issues: [] });

    const confirmed = applyQuestionnaireFieldChange(draft, {
      kind: "confirm_model_overwrite",
      fieldId: "current_location",
    });
    expect(field(confirmed, "current_location").overwrite).toMatchObject({
      reviewState: "model_overwrite_confirmed",
    });

    const reverted = applyQuestionnaireFieldChange(draft, {
      kind: "revert_model_overwrite",
      fieldId: "current_location",
    });
    expect(field(reverted, "current_location")).toMatchObject({
      origin: "manual",
      normalizedValue: { countryCode: "RU", city: "Kazan" },
      overwrite: { reviewState: "model_overwrite_reverted" },
    });
    expect(confirmOnboardingValues(confirmed).profile.profile.currentLocation).toEqual({
      countryCode: "SI",
      city: "Ljubljana",
    });
    expect(confirmOnboardingValues(reverted).profile.profile.currentLocation).toEqual({
      countryCode: "RU",
      city: "Kazan",
    });
    expect(confirmOnboardingValues(reverted).provenance.fields[0]).toMatchObject({
      origin: "manual",
      reviewState: "model_overwrite_reverted",
      previousValue: { countryCode: "RU", city: "Kazan" },
    });

    const edited = manual(draft, "current_location", { countryCode: "FR", city: "Lyon" });
    expect(field(edited, "current_location")).toMatchObject({
      origin: "manual",
      normalizedValue: { countryCode: "FR", city: "Lyon" },
      overwrite: null,
    });
  });

  test("rejects field/value mismatches, invalid rosters, and canonical cross-field contradictions", () => {
    const draft = createOnboardingDraft(() => SELF_ID);
    expect(() => model(draft, "moving_party", { amount: "0", currency: "EUR", basis: "net" } as never))
      .toThrow(TypeError);
    expect(() => manual(draft, "participants", [
      { participantId: SELF_ID, relationship: "self" },
      { participantId: SELF_ID, relationship: "spouse" },
    ])).toThrow(TypeError);
    expect(() => manual(draft, "participants", [
      { participantId: SPOUSE_ID, relationship: "spouse" },
      { participantId: SELF_ID, relationship: "self" },
    ])).toThrow(TypeError);
    expect(() => manual(draft, "participants", [
      { participantId: SELF_ID, relationship: "self" },
      ...Array.from({ length: 20 }, (_, index) => ({
        participantId: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
        relationship: "other_family" as const,
      })),
    ])).toThrow(TypeError);

    let partyMismatch = manual(draft, "moving_party", "with_companions");
    expect(reviewQuestionnaire(partyMismatch).issues).toContainEqual({
      fieldId: "participants",
      reasonCode: "party_mismatch",
    });
    partyMismatch = manual(partyMismatch, "savings", { min: "2", max: "1", currency: "EUR" });
    expect(reviewQuestionnaire(partyMismatch).issues).toContainEqual({
      fieldId: "savings",
      reasonCode: "range_mismatch",
    });
    partyMismatch = manual(partyMismatch, "country_preferences.outside_cis.mode", "required");
    partyMismatch = manual(partyMismatch, "country_preferences.outside_cis.target", "maximize");
    expect(reviewQuestionnaire(partyMismatch).issues).toContainEqual({
      fieldId: "country_preferences.outside_cis.target",
      reasonCode: "invalid_value",
    });
  });

  test("confirms exact provenance, rehydrates without raw text, and rejects non-bijective bindings", () => {
    let draft = completeDraft();
    draft = manual(draft, "current_location", { countryCode: "RU", city: "Kazan" });
    draft = model(draft, "current_location", { countryCode: "SI", city: "Ljubljana" } as never);
    const values = confirmOnboardingValues(draft);

    expect(values.schemaVersion).toBe("confirmed-onboarding-values@1");
    expect(values.provenance.fields).toHaveLength(draft.fields.length);
    expect(values.provenance.fields.find(({ fieldId }) => fieldId === "current_location")).toEqual({
      fieldId: "current_location",
      applicability: "required",
      origin: "model",
      reviewState: "model_overwrite_unreviewed",
      previousValue: { countryCode: "RU", city: "Kazan" },
      proposedValue: { countryCode: "SI", city: "Ljubljana" },
      reasonCode: "explicit_new_information",
    });
    expect(JSON.stringify(values.provenance)).not.toContain("rawInput");

    const snapshots = materializeOnboardingSnapshots({
      confirmedAt: "2026-08-22T10:00:00.000Z",
      values,
    });
    const rehydrated = rehydrateOnboardingDraft({ ...snapshots, provenance: values.provenance });
    expect(field(rehydrated, "current_location")).toMatchObject({
      rawInput: null,
      normalizedValue: { countryCode: "SI", city: "Ljubljana" },
      overwrite: { reviewState: "model_overwrite_unreviewed" },
    });
    expect(confirmOnboardingValues(rehydrated)).toEqual(values);

    const laterSnapshots = materializeOnboardingSnapshots({
      confirmedAt: "2026-08-22T10:00:01.000Z",
      values,
    });
    expect(() => rehydrateOnboardingDraft({
      profile: snapshots.profile,
      preferences: laterSnapshots.preferences,
      provenance: values.provenance,
    })).toThrow(TypeError);

    const incomplete = structuredClone(values.provenance) as unknown as {
      fields: unknown[];
    };
    incomplete.fields.pop();
    expect(() => rehydrateOnboardingDraft({ ...snapshots, provenance: incomplete as never })).toThrow(TypeError);

    const duplicate = structuredClone(values.provenance) as unknown as { fields: unknown[] };
    duplicate.fields[1] = duplicate.fields[0];
    expect(() => reconstructQuestionnaireProvenance(duplicate)).toThrow(TypeError);

    const wrongOrder = structuredClone(values.provenance) as unknown as { fields: unknown[] };
    [wrongOrder.fields[0], wrongOrder.fields[1]] = [wrongOrder.fields[1], wrongOrder.fields[0]];
    expect(() => reconstructQuestionnaireProvenance(wrongOrder)).toThrow(TypeError);

    const otherDraft = completeDraftWithSelf("00000000-0000-4000-8000-000000000099");
    const otherValues = confirmOnboardingValues(otherDraft);
    const otherSnapshots = materializeOnboardingSnapshots({
      confirmedAt: "2026-08-22T10:00:00.000Z",
      values: otherValues,
    });
    expect(() => rehydrateOnboardingDraft({
      profile: otherSnapshots.profile,
      preferences: snapshots.preferences,
      provenance: values.provenance,
    })).toThrow(TypeError);
  });

  test("reconstructs owned frozen copies and rejects hostile or non-canonical graphs", () => {
    const original = structuredClone(completeDraft());
    const reconstructed = reconstructOnboardingDraft(original);
    (original.fields[0] as { rawInput: unknown }).rawInput = "changed";
    expect(field(reconstructed, "current_location").rawInput).toEqual({ countryCode: "RU", city: "Moscow" });
    expect(Object.isFrozen(reconstructed)).toBe(true);
    expect(Object.isFrozen(reconstructed.fields[0])).toBe(true);

    const wrongOrder = structuredClone(completeDraft()) as unknown as {
      fields: unknown[];
    };
    [wrongOrder.fields[0], wrongOrder.fields[1]] = [wrongOrder.fields[1]!, wrongOrder.fields[0]!];
    expect(() => reconstructOnboardingDraft(wrongOrder)).toThrow(TypeError);

    const sparse = structuredClone(completeDraft()) as unknown as { fields: unknown[] };
    delete sparse.fields[1];
    expect(() => reconstructOnboardingDraft(sparse)).toThrow(TypeError);

    const withGetter = structuredClone(completeDraft());
    Object.defineProperty(withGetter, "schemaVersion", { enumerable: true, get: () => "onboarding-draft@1" });
    expect(() => reconstructOnboardingDraft(withGetter)).toThrow(TypeError);

    const provenance = structuredClone(confirmOnboardingValues(completeDraft()).provenance);
    (provenance.fields[0] as Record<string, unknown>).extra = true;
    expect(() => reconstructQuestionnaireProvenance(provenance)).toThrow(TypeError);

    const symbolProvenance = structuredClone(confirmOnboardingValues(completeDraft()).provenance);
    Object.defineProperty(symbolProvenance.fields, Symbol("hidden"), { value: true });
    expect(() => reconstructQuestionnaireProvenance(symbolProvenance)).toThrow(TypeError);

    const numericAliasDraft = structuredClone(completeDraft());
    Object.defineProperty(numericAliasDraft.fields, "01", { value: numericAliasDraft.fields[1], enumerable: true });
    expect(() => reconstructOnboardingDraft(numericAliasDraft)).toThrow(TypeError);

    const numericAliasProvenance = structuredClone(confirmOnboardingValues(completeDraft()).provenance);
    Object.defineProperty(numericAliasProvenance.fields, "01", {
      value: numericAliasProvenance.fields[1],
      enumerable: true,
    });
    expect(() => reconstructQuestionnaireProvenance(numericAliasProvenance)).toThrow(TypeError);
  });
});

function completeDraftWithSelf(participantId: string): OnboardingDraft {
  const draft = completeDraft();
  const next = structuredClone(draft) as unknown as { fields: Array<Record<string, unknown>> };
  const remapped = next.fields.map((item) => {
    const fieldId = item.fieldId as string;
    if (fieldId === "participants") {
      return {
        ...item,
        normalizedValue: [{ participantId, relationship: "self" }],
      };
    }
    return fieldId.includes(SELF_ID)
      ? { ...item, fieldId: fieldId.replace(SELF_ID, participantId) }
      : item;
  });
  return reconstructOnboardingDraft({ schemaVersion: "onboarding-draft@1", fields: remapped });
}
