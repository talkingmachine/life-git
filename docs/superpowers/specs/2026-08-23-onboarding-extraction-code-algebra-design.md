# Onboarding extraction prompt algebra V3

**Status:** proposed after the real V2 timing diagnostic; independent review approved; implementation
is not authorized until the user reviews this specification.

## Decision

Keep the existing `onboarding-extraction-wire@2`, its 172 valid field addresses, the exact typed
values, the 18 paired schema branches, the decoder and all Decision semantics unchanged. Replace
only the prompt's expanded `code=fieldId` table with one compact, catalog-generated ordinal
declaration and publish that prompt as `onboarding-extract@3`.

This is one versioned prompt candidate, not a prompt sweep. If its single real timing gate fails,
the work stops. It does not automatically fall through to a second prompt, a larger timeout, a
different model, sharding or a compact questionnaire.

## Evidence and root cause boundary

The installed `codex-cli 0.148.0-alpha.15` is authenticated through ChatGPT and has completed a
structured smoke invocation. The real `onboarding-model-feasibility@2` artifact passes all seven
unchanged cases and binds the exact V2 tuple. Its extraction cases complete in 7,260–19,952 ms and
its final review completes in 4,451 ms.

The canonical self-plus-spouse timing invocation was observed to fail twice in extraction at roughly
the exact 30,000 ms limit. The retained diagnostic independently anchors the latest sample:

- the model error is `onboarding_model_runtime_failed` with runtime code `codex_timeout`;
- the Codex child is terminated with `SIGTERM`;
- startup reaches `thread.started` and `turn.started`, but no completed model result appears;
- no passing timing artifact is created;
- the current invocation stdin is 15,337 UTF-8 bytes;
- the prompt template is 9,141 bytes including its 25-byte placeholder;
- the expanded 172-entry map is 7,694 bytes and its complete prompt line is 7,724 bytes;
- the unchanged output schema is 7,947 bytes and the canonical output still carries 44 applicable
  values plus two not-applicable fields.

This establishes a reproducible failure of the current V2 canonical gate while the same runtime
succeeds on smaller semantic cases. It does not prove that no V2 invocation could ever finish, nor
that the expanded map is the only cost. V3 is therefore a controlled reduction of the dominant
avoidable input term; the unchanged real gate remains the authority on whether that reduction is
sufficient.

The raw diagnostic is an explicitly authorized, ignored, mode-`0600` local debugging artifact. It
is not production evidence, is never committed, and does not relax the product rule that passing
eval artifacts store no prompt, output or transcript.

## Normative relationship

This document is a narrow successor amendment to the V2-current and no-prompt-variant clauses in:

- `docs/superpowers/specs/2026-08-20-codex-cli-runtime-design.md`;
- `docs/superpowers/plans/2026-08-21-local-conversational-onboarding.md`;
- `.superpowers/sdd/2026-08-21-local-conversational-onboarding/task-10-brief.md`.

It does not rewrite Task 10 history: V2 remains the exact implementation and evidence lineage that
was built and diagnosed. Once this specification is approved, the implementation plan must first
record V3 as one newly authorized prompt candidate in the tracked runtime design and onboarding
plan, and create a new task brief. Those documentation changes are committed before any production
RED or implementation edit. Only the two tracked docs are committed; the new task brief and progress
ledger remain ordinary `.superpowers/sdd/` ignored session artifacts and are never force-added.
V3 then becomes current only after its code is committed; V1/V2 remain historical verification
branches.

## Goals

1. Remove the 172 repeated full field IDs from the extraction prompt without changing address
   meaning or output shape.
2. Make the prompt representation injective and generated from the same catalog arrays that own the
   decoder and schema mapping.
3. Preserve byte-exact historical V1 and V2 confirmation verification.
4. Make the current lineage and regenerated evidence unambiguously V3.
5. Preserve one extraction, one review, the 30,000/15,000 ms call limits and the 35,000 ms total
   acceptance limit.

## Non-goals

- No Decision, questionnaire projection, guard, session, provenance or review-wire change.
- No change to `onboarding-extraction-wire@2`, its schema digest, proposal keys, typed values,
  `maxItems:100`, UTF-16 spans, UUID stamping or proposal order.
- No sparse or compact questionnaire input.
- No output sharding or extra Codex invocation.
- No timeout increase, model ID/service-tier pin, retry, fallback, replay, prefill, manual seed or
  alternate timing fixture.
- No SQLite migration, row rewrite, receipt-ID change, HMAC-version change or compatibility alias.

## Exact compact declaration

The prompt replaces its current one-line address explanation and the line beginning
`Exact catalog-order codebook:` with this exact block:

```text
Address algebra (all indices are zero-based ASCII decimal with no leading zeroes; + is string concatenation):
B=[current_location,move_horizon,moving_party,participants,savings];
L=[citizenships,passport,current_work,remote_continuation,monthly_income,education,relevant_experience_years];
K=[outside_cis,europe,personal_safety,infrastructure,peace_and_stability];
C=[safety,long_term_rent,urban_transit,fixed_broadband];
P=[mode,importance,target].
decode("b"+N)=B[N], N=0..4.
participant(0)="self"; participant(D)="companion."+(D-1), D=1..19.
decode("p"+D+"."+J)="participants."+participant(D)+"."+L[J], D=0..19,J=0..6.
decode("k"+I+"."+J)="country_preferences."+K[I]+"."+P[J], I=0..4,J=0..2.
decode("c"+I+"."+J)="city_preferences."+C[I]+"."+P[J], I=0..3,J=0..2.
No other f is valid.
```

The block is 785 UTF-8 bytes and is generated, not hand-maintained, from these exact existing
catalog arrays:

- `ONBOARDING_BASE_FIELD_IDS` → `B`;
- `PARTICIPANT_LEAF_IDS` → `L`;
- `COUNTRY_PREFERENCE_IDS` → `K`;
- `CITY_PREFERENCE_IDS` → `C`;
- `PREFERENCE_PARTS` → `P`.

One codec-owned participant-count constant with value `20` drives both the full codebook expansion
and the algebra's `D=0..19` bound. The prompt renderer must not carry a second literal participant
count that can drift from the decoder.

Indices are canonical unsigned decimal without leading zeroes. Existing bounds remain exact:
`N=0..4`; participant `D=0..19, J=0..6`; country `I=0..4, J=0..2`; and city
`I=0..3, J=0..2`.
The full codebook still contains exactly 172 pairs and remains the decoder/schema authority. The
prompt declaration is a compact presentation of that authority, not a second mapping.

Every other prompt rule and the exact payload
`{currentUserMessage:{text},questionnaire}` remain unchanged. The prompt still contains no message
UUID, role, completion command, durable participant ID or raw overwrite history.

Replacing the two current mapping lines with this block reduces the template from 9,141 to 1,962
bytes and the exact canonical failed invocation from 15,337 to 8,158 bytes if no other byte changes
occur: a 7,179-byte or 46.81% canonical-input reduction. The exact intended template SHA-256 is
`943f208c6b53ee409a21425d372b456a253e9ddcfd9d3f004c35be2d8c719435`.
Contract tests additionally require the static template to remain at most 2,500 bytes and the
canonical fixture prompt to remain at most 9,000 bytes. These are regression ceilings, not a claim
that byte count alone guarantees latency.

## Version lineage

Add one exact tuple:

```ts
export interface OnboardingModelVersionsV3 {
  readonly invocation: "codex-cli-invocation@1";
  readonly cliVersion: "codex-cli 0.148.0-alpha.15";
  readonly extractionPrompt: "onboarding-extract@3";
  readonly reviewPrompt: "onboarding-review@1";
  readonly extractionSchema: "onboarding-extraction-wire@2";
  readonly reviewSchema: "onboarding-review-output@1";
}
```

`OnboardingModelVersions` becomes the closed union V1 | V2 | V3, and production exports V3. The
only V2→V3 tuple change is `extractionPrompt`. V1 and V2 constants and reconstructed bytes remain
unchanged. Any extra/missing/decorated key, Proxy/accessor/symbol/custom prototype, or cross-version
hybrid fails before values are consumed.

The complete tuple remains in `versions_json` and in the unchanged
`onboarding-confirmation-binding@1` HMAC payload. Existing V1/V2 rows reopen and verify without
rewrite. New confirmations bind V3. Reusing the same completion command with different V1/V2/V3
lineage is `onboarding_completion_conflict` before clock, materialization or writes.

## Evidence lineage and real gates

The evidence formats advance because they now certify a different current prompt lineage:

- `onboarding-model-feasibility@3`;
- `onboarding-model-feasibility-diagnostic@3`;
- `onboarding-journey-timing@3`.

Both fixture formats and bytes remain unchanged at `onboarding-cases@1` and
`onboarding-canonical-journey@1`. The feasibility artifact keeps its exact 20-key layout and the
timing artifact keeps its exact 12-key layout. Schema/current-lineage fields, run-measured elapsed
values and consequent digests are regenerated. Historical `@2` artifacts are not current V3
evidence.

Before any real call, fake/static tests and an independent frozen-diff review must pass. Then:

1. Remove stale passing feasibility/timing targets through the existing alias-safe writers.
2. Run exactly one seven-case feasibility gate and require exact `onboarding-model-feasibility@3`.
3. Only on success, run exactly one canonical timing gate and require exact
   `onboarding-journey-timing@3`, nested V3 versions, `modelInvocationCount:2`, strict single-use
   handoff and `elapsedMs <= 35_000`.
4. On any failure, leave the corresponding passing target absent and stop. No automatic or manual
   prompt variant, retry or fallback is allowed under this design.

The chat already authorizes diagnostic Codex CLI calls. Each external call is still announced
before execution; no browser is used.

## Dependency direction and ownership

- Decision continues to own field catalogs, internal `LocalExtractionResult@1`, parsing, guards,
  session transitions and provenance.
- Application owns the closed V1/V2/V3 lineage policy.
- The Codex CLI Infrastructure adapter owns the catalog-generated prompt presentation and decodes
  the unchanged external wire back to the existing internal result.
- SQLite and Place Frontier depend inward on the Application reconstructor; neither duplicates a
  V3 tuple.
- Eval runners are outer composition roots and bind the exact current tuple without influencing
  domain behavior.

Clean Architecture target: 10/10. No transport optimization crosses into Decision, and no outer
runtime detail becomes an inner policy.

## Planned file boundary

Production changes are limited to:

- `src/application/onboarding-model-versions.ts`;
- `src/infrastructure/codex-cli/onboarding-extraction-wire.ts`;
- `src/infrastructure/codex-cli/onboarding-model.ts`;
- `evals/onboarding-feasibility.ts`;
- `evals/onboarding-journey-timing.ts`.

The schema, store and Frontier production files should require no semantic edit: the schema stays
byte-identical and the store/Frontier already consume the shared reconstructor. Their tests change to
prove V3 and historical behavior.

Test changes are limited to the matching codec/model/schema/version-lineage, store/Frontier and eval
contract suites. Decision tests run unchanged as regressions. The still-uncommitted Task 8 UI files,
the protected brainstorm directories and the ignored raw diagnostic remain outside the slice.

## TDD and acceptance matrix

1. **Prompt RED:** exact compact declaration is absent; expanded 172-pair serialization is present;
   template/canonical byte ceilings fail.
2. **Single-owner RED:** perturb each catalog array in a test fixture and prove the compact
   declaration and full codebook remain injectively aligned; no hand-maintained ordinal copy.
3. **Schema stability:** exact `onboarding-extraction-wire@2` schema bytes/digest, 18 paired branches,
   172 addresses and `maxItems:100` remain unchanged. The digest stays exactly
   `77fa76052dededa561a0ec596678efd067e89eb106aada6e0f68b88a33cf9c94`.
4. **Decoder stability:** all code/address pairs, typed values, order, duplicate rejection, UTF-16
   handoff, UUID stamping and hostile zero-trap cases remain unchanged.
5. **Prompt privacy:** payload stays exact and excludes message UUID/role, completion command,
   participant IDs and raw overwrite history.
6. **Lineage:** exact V1/V2/V3 tuples pass; every hybrid and hostile form fails. Production is V3.
7. **Persistence:** exact historical V1/V2 row/HMAC fixtures remain byte-identical; V3 persists and
   reaches Frontier; V1↔V3 and V2↔V3 same-command attempts conflict before issuance.
8. **Evidence:** `@3` fake artifacts bind V3 and exact digests; V1/V2/hybrids cause zero model calls;
   stale syntactically valid `@2` targets are removed; path/alias/atomic/privacy tests stay green.
9. **Canonical oracle:** all 44 applicable values plus two not-applicable remote fields remain exact;
   one extraction and one review only.
10. **Static gate:** focused suites, full tests, typecheck, full lint, production build and diff-check.
11. **Review gate:** independent review must report no Critical or Important finding before real
    calls.
12. **Real gate:** one feasibility run, then conditionally one timing run. The timing result, not the
    byte reduction, decides success.

## Alternatives deliberately deferred

### Compact questionnaire input

This could remove another roughly 4 KB, but it introduces a second input codec and lineage surface
for 39–172 ordered fields. It is a separate architecture change and is considered only if the V3
prompt experiment fails.

### Parallel extraction shards

Sharding needs ownership for roster/leaf dependencies, merge order, duplicate conflicts and
`nextQuestion`, and it exceeds the exact two-invocation contract. It is not a fallback.

### Timeout or model/service-tier pin

A larger extraction timeout cannot satisfy the 35-second journey limit. A model/service-tier pin
changes availability, cost and lineage and is separately forbidden. Neither addresses this design's
root cause boundary.

## Stop condition

Passing fake/static checks proves only contract preservation. If the one V3 real timing run does not
produce an accepted handoff in at most 35,000 ms, V3 remains a failed performance experiment. Do not
raise limits or silently proceed to another optimization. Return to product design with the new
evidence.
