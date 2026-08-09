import { describe, expect, it } from "vitest";

import {
  createProductGlobeRoute,
  MOSCOW_ORIGIN,
  TIRANA_PRESENTATION,
} from "../../src/experience/research-map/product-route";

describe("product research route", () => {
  it("uses fixed Moscow and typed Tirana metadata", () => {
    expect(MOSCOW_ORIGIN).toEqual({
      city: "Москва",
      country: "Россия",
      flag: "🇷🇺",
      coordinate: { lat: 55.7558, lng: 37.6173 },
    });
    expect(TIRANA_PRESENTATION).toMatchObject({
      city: "Тирана",
      country: "Албания",
      flag: "🇦🇱",
      coordinate: { lat: 41.3275, lng: 19.8187 },
      photoUrl: "/cities/tirana.jpg",
    });
  });

  it("maps evidence-owned status and reason without name lookup", () => {
    const route = createProductGlobeRoute({
      id: "tirana",
      ...TIRANA_PRESENTATION,
      status: "red",
      reason: { summary: "Основание не подтверждено", officialUrl: "https://official.example/rule" },
    });
    expect(route).toMatchObject({
      key: "moscow-tirana",
      from: MOSCOW_ORIGIN.coordinate,
      to: TIRANA_PRESENTATION.coordinate,
      status: "red",
      rejectionReason: "Основание не подтверждено",
      officialUrl: "https://official.example/rule",
    });
  });
});
