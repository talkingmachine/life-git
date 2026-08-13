import type { GlobeOrigin, GlobeRoute, ResearchCandidate } from "./contracts";

export const MOSCOW_ORIGIN: GlobeOrigin = {
  label: "Москва",
  kind: "city",
  city: "Москва",
  country: "Россия",
  flag: "🇷🇺",
  coordinate: { lat: 55.7558, lng: 37.6173 },
};

export const TIRANA_PRESENTATION: Omit<ResearchCandidate, "id" | "status" | "reason"> = {
  label: "Тирана",
  kind: "city",
  city: "Тирана",
  country: "Албания",
  flag: "🇦🇱",
  coordinate: { lat: 41.3275, lng: 19.8187 },
  description: "Проверяем визовые, финансовые и бытовые условия сценария.",
  photoUrl: "/cities/tirana.jpg",
};

export function createProductGlobeRoute(
  origin: GlobeOrigin,
  candidate: ResearchCandidate,
  runKey: string,
): GlobeRoute {
  return {
    label: candidate.label,
    kind: candidate.kind,
    city: candidate.city,
    country: candidate.country,
    description: candidate.description,
    flag: candidate.flag,
    key: `${runKey}:${candidate.id}`,
    routeLabel: `${origin.label} → ${candidate.label}`,
    from: origin.coordinate,
    photoUrl: candidate.photoUrl,
    rejectionReason: candidate.reason?.summary,
    officialUrl: candidate.reason?.officialUrl,
    officialUrls: candidate.reason?.officialUrls,
    manualCheckLinks: candidate.reason?.manualCheckLinks,
    status: candidate.status,
    statusLabel: candidate.statusLabel,
    to: candidate.coordinate,
  };
}
