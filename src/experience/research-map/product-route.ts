import type { GlobeOrigin, GlobeRoute, ResearchCandidate } from "./contracts";

export const MOSCOW_ORIGIN: GlobeOrigin = {
  city: "Москва",
  country: "Россия",
  flag: "🇷🇺",
  coordinate: { lat: 55.7558, lng: 37.6173 },
};

export const TIRANA_PRESENTATION: Omit<ResearchCandidate, "id" | "status" | "reason"> = {
  city: "Тирана",
  country: "Албания",
  flag: "🇦🇱",
  coordinate: { lat: 41.3275, lng: 19.8187 },
  description: "Проверяем визовые, финансовые и бытовые условия сценария.",
  photoUrl: "/cities/tirana.jpg",
};

export function createProductGlobeRoute(candidate: ResearchCandidate): GlobeRoute {
  return {
    city: candidate.city,
    country: candidate.country,
    description: candidate.description,
    flag: candidate.flag,
    key: `moscow-${candidate.id}`,
    label: `Москва → ${candidate.city}`,
    from: MOSCOW_ORIGIN.coordinate,
    photoUrl: candidate.photoUrl,
    rejectionReason: candidate.reason?.summary,
    officialUrl: candidate.reason?.officialUrl,
    status: candidate.status,
    to: candidate.coordinate,
  };
}
