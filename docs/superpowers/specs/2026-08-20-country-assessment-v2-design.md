# Country Assessment V2 Design

| Поле | Значение |
| --- | --- |
| Статус | `approved` |
| Владелец решения | пользователь проекта |
| Дата | 2026-08-20 |
| Область | formal country assessment для `relocation-profile@2` |
| Зависимости | Local Conversational Onboarding, Country Evidence, Formal Residence Verdict |
| Supersedes | только отсутствующую ветку `@2`; `cold-start-assessment@1` не изменяется |
| Approval | пользователь проекта / 2026-08-20 / choices `1,1,1` / approved |

## 1. Цель

Новая onboarding-анкета сохраняет отдельные данные всех участников, но намеренно не спрашивает
юридическую форму удалённой работы, route-specific legality, страховку и другие сведения выбранного
маршрута. `Country Assessment V2` должен использовать известные данные без выдумывания
недостающих фактов и передавать результат в существующий formal country verdict.

Он не является новым поиском стран, legal engine или вторым marker pipeline. Он переводит один
проверенный `relocation-profile@2` и одну sealed Country Evidence/Dossier revision в существующие
`ResidenceRouteOutcome`, после чего вызывает существующий `assessFormalResidence`.

## 2. Утверждённые решения

1. Participant с `relationship: self` является основным заявителем.
2. Маршрут оценивается для всей заявленной группы, а не только для `self`.
3. Для каждого сопровождающего нужен официальный проверенный companion path. Непроверенный path
   делает маршрут `unknown`; доказанная несовместимость обязательного участника делает его
   `impossible`.
4. Паспорт проверяется относительно всего interval переезда. Он `verified`, только когда его срока
   достаточно для поздней границы; `impossible`, только когда срока не хватает даже для ранней;
   пересечение интервала или открытая поздняя граница дают `unknown`.
5. Явное текущее несоответствие проверенному требованию конкретного маршрута даёт `impossible`.
   Будущая смена паспорта, работы или дохода не предполагается автоматически.
6. Country marker остаётся красным только тогда, когда существующий `formal-residence@1` получил
   полный применимый catalog и каждый маршрут доказанно `impossible`.

## 3. Неизменяемые границы

- `assessColdStart`, `COLD_START_ASSESSMENT_RULES_VERSION = "cold-start-assessment@1"`,
  `relocation-profile@1` и их canonical replay bytes остаются неизменными.
- Новая ветка использует `COLD_START_ASSESSMENT_V2_RULES_VERSION =
  "cold-start-assessment@2"` и принимает только `relocation-profile@2`.
- Обе assessment-версии используют существующий `formal-residence@1`; второй marker/verdict engine
  не создаётся.
- Dispatch выполняется только по exact profile schema version. Нет coercion `@2 -> @1`, runtime
  registry, generic assessment graph или fallback.
- Модель не создаёт citizenship class, employment relation, legal status, FX, income threshold,
  companion eligibility, reason или marker.
- `RankingSnapshot` остаётся `place-ranking@1`, а Country Frontier — `country-frontier@1`.

## 4. Входной контракт

```ts
export interface CountryAssessmentInputV2 {
  readonly schemaVersion: "country-assessment-input@2";
  readonly profileSnapshotId: string;
  readonly profile: RelocationProfileV2Snapshot;
}

export interface ColdStartAssessmentInputV2 {
  readonly assessmentAt: string;
  readonly profile: CountryAssessmentInputV2;
  readonly evidence: EvidenceSnapshot<SloveniaSourceId, ColdStartEvidenceClaimV2>;
  readonly dossier?: DossierVersionV2;
  readonly completeness?: CatalogCompletenessAttestation;
  readonly sourceNavigation: Readonly<Record<SloveniaSourceId, string>>;
  readonly sourceResolvedEvidence?: Readonly<Record<SloveniaSourceId, string>>;
}
```

`CountryAssessmentInputV2` является lossless descriptor-safe snapshot: все participants и их typed
values сохраняются отдельно. Он ничего не агрегирует, не выбирает route и не содержит verdict.

`profile.profileSnapshotId` обязан точно совпадать с `profile.profile.id`, а вложенный snapshot
обязан иметь `schemaVersion: "relocation-profile@2"`.

Assessment принимает только exact verified Profile/Evidence/Dossier bindings. Missing или
incomplete official source остаётся существующим research-incomplete/unknown исходом; capability
failure не маскируется под domain uncertainty.

Optional completeness принимается только после exact reconstruction: `scopeKind`, jurisdiction,
profile ID, effective interval, catalog routes and all sealed Evidence references должны
соответствовать assessment profile/date/Evidence. Только этот объект передаётся в
`assessFormalResidence`; отсутствие или mismatch не может привести к red.

Для Slovenia accepted attestation дополнительно требует `jurisdiction === "SI"`, exact
`profileSnapshotId`, `evidenceSnapshotId === evidence.id`, effective interval, покрывающий
`assessmentAt`, и applicable catalog route IDs, точно равные derived formal route IDs. Separately
proved excluded catalog routes могут присутствовать рядом. Каждая catalog Evidence reference
использует `evidence.id`, а её `artifactId` существует в `evidence.artifactIds`. При пустом derived
route set attestation отбрасывается, чтобы пустое исследование не стало red по vacuous truth.
Descriptor-safe mismatch отбрасывается до formal call, а не превращается в domain result. Пока
verified catalog-attestation producer/loader отсутствует и installed Slovenia catalog имеет
`completeness: "unproven"`, production передаёт `undefined`; synthetic test attestation проверяет
только formal seam и не является production completeness proof.

### Отдельные Evidence/Dossier V2

Исторические `ColdStartEvidenceClaim`, `vs2-si-evidence@2` и `si-dossier@1` не расширяются. Для
нового assessment создаются отдельные `ColdStartEvidenceClaimV2`, rules
`vs2-si-evidence@3` и `DossierVersionV2` со schema `si-dossier@2`. Они могут ссылаться на те же
retained official artifacts, но имеют отдельные parser/rules versions и canonical replay.

Историческая таблица `dossier_versions` остаётся V1-only и не меняет constraints или bytes. V2
использует отдельную immutable `dossier_versions_v2` с собственной predecessor chain и Evidence
foreign key. Exact identity/read key равен `(countryCode, payloadHash, evidenceSnapshotId)`.
Повтор того же verified Evidence idempotent; новый Evidence Snapshot с тем же canonical dossier
payload создаёт новую V2 revision, потому что downstream assessment требует exact
`dossier.evidenceSnapshotId === evidence.id`. `payloadHash` по-прежнему равен
`sha256(canonicalJson(payload))` и не становится Evidence-binding digest. V2 lookup без точного
Evidence ID запрещён. Отдельные FK/index/immutability triggers исключают смешанную V1/V2 chain, а
open-time preflight отвергает несовместимую существующую V2 schema до DDL.

Три значения, которых не было в V1, имеют закрытые shapes:

```ts
export interface CitizenshipApplicabilityV2 {
  readonly classifications: readonly {
    readonly countryCode: string;
    readonly status: "eligible" | "excluded";
  }[];
}

export interface CompanionEntryV2 {
  readonly relationshipClassifications: readonly {
    readonly relationship: "spouse" | "minor_child" | "other_family";
    readonly status: "eligible" | "excluded";
  }[];
}

export interface IncomeRequirementV2 {
  readonly metric: "latest_official_average_monthly_net_salary";
  readonly multiplier: "2";
  readonly thresholdEur: string;
  readonly currency: "EUR";
  readonly basis: "net";
  readonly appliesTo: "applicant";
  readonly period: string;
}
```

Every classification/value must reproduce retained official content and carry the claim's normal
sealed Evidence references. Missing country/relationship classification means `unknown`, never
implicit eligibility/exclusion. The competition V2 FX surface remains exactly direct EUR plus the
existing sealed `cbr-eur` EUR/RUB claim; other ISO currencies are accepted by onboarding but remain
`unknown` here. Adding another pair requires a separately sealed SourceId/claim, not a generic FX
lookup.

The remaining route-basis, remote-relation and qualification V2 claim values copy their V1
semantic fields into the separate V2 union. Duration and statutory V2 values additionally require
an exact scope:

```ts
export type ParticipantRequirementScopeV2 =
  | { readonly kind: "applicant" }
  | {
      readonly kind: "companion";
      readonly relationship: "spouse" | "minor_child" | "other_family";
    };
```

The applicant digital-nomad duration/statutory claim uses `{ kind: "applicant" }`; it may not be
reused for a companion. Companion passport evaluation requires separate official duration and
statutory claims scoped to that companion relationship. These V2 values do not alias or rewrite V1 bytes.
If official capture cannot prove any new typed classifier/scope, that V2 claim is unavailable and
the corresponding assessment component is `unknown`.

Country Assessment V2 является singleton-route contract. `cold-start-contracts-v2` владеет exact
mapping `temporary_residence_digital_nomad -> si-temporary-residence-digital-nomad`, экспортирует
`SLOVENIA_V2_FORMAL_ROUTE_ID`, и тем самым задаёт единственный route и его порядок. Dossier claim
order не является route order, и `assessColdStartV2` не придумывает другие route IDs. Без dossier
route не выводится: formal input содержит пустой routes, `participantAssessments` пуст, а результат
остаётся yellow с `research_incomplete`.

## 5. Participant assessment

Для каждого route строится participant-scoped внутренний результат:

```ts
export interface ParticipantRouteAssessmentV2 {
  readonly routeId: string;
  readonly participantId: string;
  readonly relationship: "self" | "spouse" | "minor_child" | "other_family";
  readonly status: "verified" | "unknown" | "impossible";
  readonly reasonCodes: readonly CountryAssessmentV2ReasonCode[];
  readonly claimIds: readonly string[];
}
```

- `self` проверяется по основному route.
- Каждый companion проверяется только по sealed `companion_entry`/другому применимому official
  claim. Relationship считается поддержанным только при точном official classifier; слово
  `immediate family` без typed relationship mapping недостаточно для `verified`.
- Для Slovenia V2 package отдельный `companion-entry-classifier@1` parser заполняет
  `relationshipClassifications` только из retained official text. Он не изменяет V1 claim;
  до доказанного V2 classifier companion path честно `unknown`.
- `companion-entry-classifier@1` является внутренним классификатором source parser
  `si-route@3`; persisted `companion_entry.validatorVersion` и claim ID используют
  `si-route@3`, а Evidence `parserVersions["si-digital-nomad-route"]` остаётся единственным
  source-level parser binding.
- `other_family` не приравнивается к spouse/minor child; без отдельного official rule это `unknown`.
- Работа, доход и образование companion не влияют на основной route, если официальный claim явно
  их не потребляет.
- Participant IDs не входят в reason code и не раскрываются наружу как персональные данные;
  participant detail хранится в assessment projection отдельно от `FormalReason`.

Route aggregation имеет фиксированный порядок:

1. хотя бы один доказанный participant mismatch -> `impossible`;
2. иначе хотя бы один participant или route prerequisite `unknown` -> `unknown`;
3. иначе route -> `viable`.

Canonical projection order is the singleton derived route order, then the exact participant order
from `RelocationProfileV2Snapshot` within that route. Every `(routeId, participantId)` pair occurs
exactly once; missing, duplicate or reordered pairs fail reconstruction.

Hard mismatch является достаточным доказательством невозможности конкретного route и не
понижается до `unknown` из-за другой недостающей информации. Поэтому formal `impossible` route
содержит только decisive proved mismatch reasons с non-empty claim IDs/sealed Evidence. Остальные
unknown сохраняются в route-bound `participantAssessments`, но не добавляются в determining
`route.reasons`; это сохраняет существующую proof-normalization `formal-residence@1`.

## 6. Citizenship

- Каждая citizenship каждого participant передаётся в официальный exact classifier установленного
  country package.
- `impossible` допустим только когда official claim доказывает, что ни одна заявленная citizenship
  не подходит для применимого participant path либо явно исключена.
- `verified` допустим только когда official claim точно классифицирует хотя бы одну citizenship как
  применимую и не оставляет конфликтующих необработанных условий.
- Отсутствующий classifier, неполный catalog или неоднозначная multi-citizenship комбинация дают
  `unknown`; код не содержит hard-coded `RU`, EU/CIS list или собственную nationality taxonomy.

## 7. Passport и move horizon

Move horizon переводится в inclusive calendar interval относительно `assessmentAt`:

| Horizon | Ранняя граница | Поздняя граница |
| --- | --- | --- |
| `within_3_months` | `assessmentAt` | `assessmentAt + 3 months` |
| `3_to_6_months` | `assessmentAt + 3 months` | `assessmentAt + 6 months` |
| `6_to_12_months` | `assessmentAt + 6 months` | `assessmentAt + 12 months` |
| `more_than_12_months` | `assessmentAt + 12 months` | open |

Calendar addition использует существующее UTC month-clamping правило. Для `self` используются
только applicant-scoped official `duration.maximumMonths` и
`general_statutory_prerequisites.passportBeyondPermitMonths` образуют необходимый запас после
предполагаемой даты переезда.

Каждая move boundary сначала вычисляется через `addUtcMonthsClamped(assessmentAt, horizonOffset)`.
Passport-required date затем вычисляется от уже clamped move boundary добавлением
`maximumMonths + passportBeyondPermitMonths`; horizon и permit offsets не объединяются в одно
сложение. Поэтому `2026-01-31 + 3 months = 2026-04-30`, затем `+ 15 months = 2027-07-30`, а не
`2027-07-31`. Expiry раньше required early boundary означает `impossible`; finite late boundary и
expiry не раньше неё означают `verified`; остальные случаи, включая open late boundary, дают
`unknown`. `passport: absent` становится `impossible` только когда оба exact scoped claims
доказывают требование. Applicant scope никогда не обслуживает companion.

Для companion используются только claims с `ParticipantRequirementScopeV2` для его exact
relationship. Если companion path не имеет собственных scoped duration/statutory claims, его
passport component и весь participant path остаются `unknown`; applicant terms не копируются.

- `passport: absent` при доказанном passport requirement -> `passport_validity_insufficient` и
  participant `impossible`.
- Expiry раньше необходимой ранней даты -> `passport_validity_insufficient` и `impossible`.
- Expiry не раньше необходимой поздней даты -> passport component `verified`.
- Expiry внутри interval либо open late boundary при достаточности для ранней даты ->
  `passport_validity_unknown` и `unknown`.
- Невалидная дата является integrity error до assessment, а не formal outcome.

## 8. Work, legality и insurance

- `remote_continuation: yes` подтверждает только намерение/возможность продолжить текущую работу.
  Оно не доказывает `foreign_employer`, `own_foreign_business`, `foreign_clients` или legal status.
- `current_work.status` также не выводит employer/client jurisdiction. `employment` нельзя
  превращать в `foreign_employment`, а `self_employment`/`contract_service` — в
  `foreign_service`.
- Если route требует remote work, `remote_continuation: no` является текущим доказанным mismatch:
  reason `remote_continuation_unavailable`, route `impossible`.
- Если route требует remote work, а `current_work.status: not_working`, неприменимый
  `remote_continuation` не превращается в missing answer: это тот же текущий доказанный mismatch
  `remote_continuation_unavailable`, route `impossible`.
- При `remote_continuation: yes`, но без exact relation или legality, используются существующие
  `remote_work_prerequisite_unknown` и route `unknown`.
- Route-specific legality не собирается onboarding и всегда остаётся unknown до отдельного
  route-specific подтверждения.
- Текущий `@2` input не содержит exact remote-work relation или route-specific legality proof.
  Поэтому установленный digital-nomad route не может стать `viable` в Tasks 1–5:
  `remote_continuation: yes` остаётся `unknown`, а relation/legality нельзя выводить из
  `current_work` или намерения продолжить работу. Viable path откладывается до отдельно sealed
  route-specific факта.
- Не собранная health insurance не делает route impossible/unknown: при официальном требовании
  она остаётся существующим procedural action `insurance`.

## 9. Income и FX

- Сравнение выполняется только для participant/scope, которые прямо названы official income
  claim. Значения разных участников не суммируются без отдельного официального household rule.
- `net` сравнивается только с `net`, `gross` — только с `gross`; basis mismatch даёт
  `income_basis_not_comparable`, а не приблизительный расчёт.
- EUR сравнивается напрямую по `FORMULA-VS2-INCOME-EUR-01`.
- RUB переводится в EUR только по свежему sealed CBR EUR/RUB claim с существующей
  `FORMULA-VS2-INCOME-01`.
- Любая другая currency в competition V2 даёт `fx_rate_unavailable` и `unknown`; никакой иной FX
  SourceId в этом contract не установлен.
- Сопоставимый текущий доход ниже подтверждённого threshold даёт
  `income_below_verified_threshold` и route `impossible`; будущий рост дохода не предполагается.
- Ноль остаётся обычным подтверждённым числом, а не missing value.

## 10. Qualification, experience и savings

Education, experience, savings и current location сохраняются в profile/replay, но не влияют на
formal route outcome без sealed official claim, который явно их потребляет. Код не создаёт
qualification, wealth или location eligibility самостоятельно.

## 11. Выход и reason codes

```ts
export const COLD_START_ASSESSMENT_V2_RULES_VERSION =
  "cold-start-assessment@2" as const;

export type CountryAssessmentV2ReasonCode =
  | "citizenship_excluded"
  | "citizenship_applicability_unknown"
  | "companion_route_unverified"
  | "companion_route_impossible"
  | "passport_validity_insufficient"
  | "passport_validity_unknown"
  | "remote_continuation_unavailable"
  | "remote_work_prerequisite_unknown"
  | "income_below_verified_threshold"
  | "income_basis_not_comparable"
  | "fx_rate_unavailable"
  | "fx_rate_stale"
  | "country_evidence_incomplete"
  | "country_not_installed"
  | "route_requirements_verified";

export interface ColdStartFormulaEurV2 {
  readonly formulaId: "FORMULA-VS2-INCOME-EUR-01";
  readonly formulaVersion: "1";
  readonly expression: "monthlyIncomeEur < thresholdEur";
  readonly monthlyIncomeEur: string;
  readonly thresholdEur: string;
  readonly rounding: "UNROUNDED_THEN_HALF_UP_2DP";
  readonly sourceClaimIds: readonly string[];
}

export type ColdStartComparatorV2 = Omit<ColdStartComparator, "formula"> & {
  readonly participantAssessments: readonly ParticipantRouteAssessmentV2[];
  readonly formula?: ColdStartFormula | ColdStartFormulaEurV2;
};

export function assessColdStartV2(
  input: ColdStartAssessmentInputV2,
): ColdStartComparatorV2;
```

Every `viable`/`impossible` route must retain current effective interval, non-empty sealed Evidence,
claim IDs and exact Evidence Snapshot binding. Otherwise existing `assessFormalResidence` lowers it
to `unknown`. `ColdStartComparatorV2.marker` must equal `formalVerdict.marker`.

The participant projection is part of assessment replay and UI explanation, but formal marker is
still derived only from existing `ResidenceRouteOutcome[]` and
`CatalogCompletenessAttestation`.

## 12. Application, persistence и wire compatibility

Only these consumers widen the assessment-version union to
`"cold-start-assessment@1" | "cold-start-assessment@2"`:

- `ColdStartReadModel.assessmentRulesVersion`;
- `CountryVerificationResult.sourceAssessmentRulesVersion`;
- `FrontierMarker.sourceAssessmentRulesVersion`;
- Country verification replay expectations and marker reconstruction;
- cold-start/place-frontier stream schemas and view-model normalization.

The read-model/comparator contract becomes an exact discriminated union: an `@1` rules version may
contain only the existing `ColdStartComparator`/formula schema, while `@2` must contain only
`ColdStartComparatorV2`, route-bound participant assessments and the V2 formula union. Mixed
version/comparator pairs and extra/missing fields fail reconstruction.

The existing `CountryVerifierPort` remains ID-based. `PlaceFrontierApplication` and
`CountryResolutionApplication` continue to pass the profile ID already sealed into their
ranking/revision. `createCountryVerifierAdapter` transfers that opaque ID to Cold Start and never
loads the profile or guesses its schema.

Cold Start adds one dedicated verified union loader while the existing V1 loader remains unchanged
for Place Frontier and historical callers:

```ts
loadRelocationAnyVerified(
  id: string,
): Promise<RelocationProfileSnapshot | RelocationProfileV2Snapshot>;
```

Cold Start alone owns and consumes that exact verified union load. Its `prepareAny`, `runAny` and
`presentAny` ID paths bind the loaded snapshot ID to the requested/sealed profile ID and dispatch directly by the reconstructed
`schemaVersion`: `relocation-profile@1 -> assessColdStart`,
`relocation-profile@2 -> assessColdStartV2`. The direct `{ profile: RelocationProfileDraft }` path
and the inherited V1 `prepare`, `run` and `present` methods remain strictly `@1`. There is no adapter dispatch, registry, coercion or fallback. Onboarding
reaches `@2` only through its persisted receipt/profile ID. This preserves the current
`CountryVerifierPort` surface and keeps schema ownership inside the use case that already loads and
assesses the profile.

Evidence persistence stays generic internally, while every application read remains versioned and
closed. The historical Country Knowledge projection accepts only `vs2-si-evidence@2` with the exact
V1 parser map. A separate V2 projection accepts only `vs2-si-evidence@3` with
`SLOVENIA_V2_PARSER_VERSIONS`; V1, V3 and unknown rules never cross-cast. V2 replay performs this
exact verified load before the existing rules-aware replay. The outward Cold Start Knowledge port
does not widen: its store dispatches internally by the verified stored rules version and rejects
anything other than the two explicit branches.

Country Knowledge continues to persist `country-knowledge@1` in the same append-only linear chain.
It fully validates every V3 claim and Evidence reference, but publishes compact references only for
unscoped V2 country claims. Scoped `duration` and
`general_statutory_prerequisites` are intentionally absent because the historical
`FormalKnowledgeReference` has no participant-scope field and permits only one reference per
`ClaimKind`. When V3 supplies one of those scoped kinds, the corresponding predecessor reference
and status are retired rather than carried forward or selected by array order. Scope remains in the
V2 Dossier and Assessment; no optional scope field or new Knowledge schema is introduced here. V1
revision bytes are unchanged, and a V2-triggered revision may append after a V1 predecessor without
rewriting it. Existing transient-source atomicity also remains unchanged: a relevant timeout,
deadline, rate limit or server error publishes no Knowledge successor, leaving the predecessor
current and deferring scoped retirement until an otherwise publishable revision.

Participant explanations remain in the canonical Country Frontier result instead of disappearing
after `assessColdStartV2`. Cold Start constructs this projection while it still owns both the
verified profile participant order and reconstructed dossier route order; the outer adapter only
copies the already checked projection and does not attempt to infer either order from opaque IDs:

```ts
export interface CountryAssessmentProjectionV2 {
  readonly schemaVersion: "country-assessment-projection@2";
  readonly profileSnapshotId: string;
  readonly evidenceSnapshotId: string;
  readonly participantAssessments: readonly ParticipantRouteAssessmentV2[];
}

export type CountryVerificationResult =
  | (CountryVerificationResultCommon & {
      readonly sourceAssessmentRulesVersion: "cold-start-assessment@1";
      readonly assessmentProjection?: never;
    })
  | (CountryVerificationResultCommon & {
      readonly sourceAssessmentRulesVersion: "cold-start-assessment@2";
      readonly assessmentProjection: CountryAssessmentProjectionV2;
    });

export type CountryVerificationPresentation =
  | Omit<Extract<CountryVerificationResult, {
      sourceAssessmentRulesVersion: "cold-start-assessment@1";
    }>, "countryCheckRunId">
  | Omit<Extract<CountryVerificationResult, {
      sourceAssessmentRulesVersion: "cold-start-assessment@2";
    }>, "countryCheckRunId">;

export type FrontierMarker =
  | (FrontierMarkerCommon & {
      readonly sourceAssessmentRulesVersion: "cold-start-assessment@1";
      readonly assessmentProjection?: never;
    })
  | (FrontierMarkerCommon & {
      readonly sourceAssessmentRulesVersion: "cold-start-assessment@2";
      readonly assessmentProjection: CountryAssessmentProjectionV2;
    });
```

`CountryVerificationResultCommon` and `FrontierMarkerCommon` are the existing non-version fields;
they do not create another persisted envelope. `CountryVerifierPort.present` returns
`CountryVerificationPresentation`, not a non-distributive `Omit` over the whole union.

Cold Start derives the dense dossier-route × verified-profile-participant order and reconstructs the
projection from `comparator.participantAssessments` without aggregation or relabeling before it
returns the `@2` read model. The adapter only checks the same profile and Evidence Snapshot IDs and
copies that already verified projection; it never infers order from opaque IDs.
`materializeFrontierMarker`, `countryVerificationReplayExpectation`, marker persistence, stream
normalization and view-model reconstruction retain that exact dense ordered projection. A pure
structural reconstructor checks exact keys, both ID bindings, closed reason codes, unique
`(routeId, participantId)` pairs, stable relationships and a dense route-major rectangle before
returning a private frozen copy. The existing order-aware `reconstructCountryAssessmentProjectionV2`
additionally requires the independent profile-participant × dossier-route order and remains the only
semantic order oracle. Persisted and wire boundaries cannot recover that order from an opaque
profile ID and MUST NOT derive it from the projection under test: they perform structural validation
and rely on their existing enclosing integrity where present. A schema-valid whole-grid reorder is
rejected when Place Frontier or Country Resolution calls semantic `present`, obtains the freshly
order-verified Cold Start result and canonical-compares the complete marker. `@1` result/marker
bytes have no `assessmentProjection` key. Missing/extra projection data, mixed rules versions and
changed participant/route/status/reason/claim IDs fail reconstruction as `integrity_mismatch`. The
projection explains a verdict; it never participates in marker calculation a second time.

For the live Cold Start stream, `x-life-profile-id` and the Journey profile prop are the external
profile binding: every V2 terminal projection must match that profile ID and the terminal Evidence
ID before rendering. The browser uses a local strict schema and never runtime-imports the
Node-backed Application reconstructor. Place Frontier direct preparation remains V1-only, while
run/present exact-load the persisted profile pair and accept only matching `@1/@1` or `@2/@2`
relocation/preference versions before invoking country verification; mixed pairs fail closed.

`SqliteProfileStore` has separate `@1` and `@2` reconstruction branches. `@1` hashes/bytes are
unchanged. `@2` assessment and participant projections are canonical, immutable and replayed with
exact profile/evidence/dossier/assessment-date bindings.

## 13. Acceptance scenarios

1. Canonical `self + spouse` never drops or merges participant data.
2. Route может быть `viable` только когда каждый participant и route prerequisite verified.
   Текущий onboarding-only digital-nomad input не может выполнить это условие, потому что exact
   remote relation/legality отсутствует.
3. The same self route with an unclassified spouse path is `unknown`, not green.
4. A proven companion exclusion makes that route `impossible`.
5. A passport valid through the late interval passes; one expiring before the early interval fails;
   one expiring inside the interval is unknown.
6. `passport: absent`, `remote_continuation: no` or comparable income below threshold makes the
   exact requiring route impossible.
7. `remote_continuation: yes` without relation/legality remains unknown and never becomes foreign
   employment/service.
8. EUR uses direct comparison; fresh CBR supports RUB; unsupported/unsealed FX remains unknown.
9. Missing insurance appears only as a procedural action.
10. Любой viable route, когда будущий separately sealed legality input сделает его достижимым,
    produces green; текущий route остаётся unknown/yellow. All impossible produce red only with
    verified complete catalog.
11. Historical `@1` fixtures, hashes, stream bytes and replay remain unchanged.
12. Cold Start rejects a requested/sealed profile ID mismatch before research calls; the
    Infrastructure adapter transfers only the opaque ID and never schema-dispatches it.
13. An `@2` participant projection survives check, marker persistence, stream transport and replay
    byte-for-byte; any mutation or `@1`/`@2` projection mismatch is rejected.

## 14. Не-цели

- Legal advice, legal probability or prediction of future user actions.
- Automatic route selection, automatic Yellow Resolution or silent acceptance of risk.
- Hard-coded country/citizenship lists, inferred employer jurisdiction or household-income sum.
- New formal marker engine, generic assessment registry, decision graph, fallback or retry loop.
- Collecting route-specific form fields in onboarding.

## 15. Approval record

Пользователь последовательно выбрал:

1. whole-group route viability;
2. interval passport evaluation;
3. current-facts mismatch semantics.

Затем пользователь утвердил объединённый дизайн отдельным ответом `да` 2026-08-20.
