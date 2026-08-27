import type {
  CountrySourceIndexPort,
  CountrySourceIndexResult,
  SourceCandidate,
} from "../../research/cold-start-contracts";

function freezeCandidate(candidate: SourceCandidate): SourceCandidate {
  return Object.freeze({
    ...candidate,
    claimKinds: Object.freeze([...candidate.claimKinds]),
  });
}

const SLOVENIA_CANDIDATES = Object.freeze([
  freezeCandidate({
    candidateId: "gov-route",
    url: "https://www.gov.si/en/news/2025-11-21-temporary-residence-permit-for-digital-nomads/",
    authorityRoot: "https://www.gov.si",
    claimKinds: ["route_basis", "citizenship_applicability", "remote_work_relations", "qualification", "companion_entry", "duration", "general_statutory_prerequisites"],
    discoveredFrom: "registry",
  }),
  freezeCandidate({
    candidateId: "ztuj2",
    url: "https://pisrs.si/Pis.web/pregledPredpisa?id=ZAKO5761&print=1",
    authorityRoot: "https://pisrs.si",
    claimKinds: ["route_basis", "citizenship_applicability", "remote_work_relations", "qualification", "companion_entry", "duration", "general_statutory_prerequisites"],
    discoveredFrom: "registry",
  }),
  freezeCandidate({
    candidateId: "salary-publication",
    url: "https://pisrs.si/pregledPredpisa?sop=2026-01-1950",
    authorityRoot: "https://pisrs.si",
    claimKinds: ["income"],
    discoveredFrom: "registry",
  }),
  freezeCandidate({
    candidateId: "sistat",
    url: "https://pxweb.stat.si/SiStatData/pxweb/en/Data/-/H285S.px/",
    authorityRoot: "https://pxweb.stat.si",
    claimKinds: ["income"],
    discoveredFrom: "registry",
  }),
  freezeCandidate({
    candidateId: "ess-companion",
    url: "https://www.ess.gov.si/delodajalci/zaposlovanje-tujcev-iz-tretjih-drzav/zaposlitev-tujcev-z-dovoljenjem-za-prebivanje/",
    authorityRoot: "https://www.ess.gov.si",
    claimKinds: ["companion_local_work_access"],
    discoveredFrom: "registry",
  }),
  freezeCandidate({
    candidateId: "zzsdt",
    url: "https://pisrs.si/Pis.web/pregledPredpisa?id=ZAKO6655",
    authorityRoot: "https://pisrs.si",
    claimKinds: ["companion_local_work_access"],
    discoveredFrom: "registry",
  }),
]);

const INSTALLED_SLOVENIA = Object.freeze({
  ok: true as const,
  candidates: SLOVENIA_CANDIDATES,
}) satisfies CountrySourceIndexResult;

const COUNTRY_NOT_INSTALLED = Object.freeze({
  ok: false as const,
  kind: "country_not_installed" as const,
  candidates: Object.freeze([]) as readonly [],
}) satisfies CountrySourceIndexResult;

export function createInstalledCountrySourceIndex(): CountrySourceIndexPort {
  return Object.freeze({
    lookup(countryCode: string): CountrySourceIndexResult {
      return countryCode === "SI" ? INSTALLED_SLOVENIA : COUNTRY_NOT_INSTALLED;
    },
  });
}
