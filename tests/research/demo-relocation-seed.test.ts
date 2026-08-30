import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { readDemoRelocationSeed } from "../../src/research/demo-relocation-seed";

const EXPECTED = [
  {
    countryCode: "SI", name: ["Словения", "Slovenia"], localeHints: ["sl", "en"],
    cities: [
      ["ljubljana", "Любляна", "Ljubljana", "national_capital"],
      ["maribor", "Марибор", "Maribor", "relocation_city"],
      ["koper", "Копер", "Koper", "relocation_city"],
      ["celje", "Целе", "Celje", "relocation_city"],
      ["kranj", "Крань", "Kranj", "relocation_city"],
    ],
  },
  {
    countryCode: "PT", name: ["Португалия", "Portugal"], localeHints: ["pt", "en"],
    cities: [
      ["lisbon", "Лиссабон", "Lisbon", "national_capital"],
      ["porto", "Порту", "Porto", "relocation_city"],
      ["braga", "Брага", "Braga", "relocation_city"],
      ["coimbra", "Коимбра", "Coimbra", "relocation_city"],
      ["funchal", "Фуншал", "Funchal", "relocation_city"],
    ],
  },
  {
    countryCode: "ES", name: ["Испания", "Spain"], localeHints: ["es", "en"],
    cities: [
      ["madrid", "Мадрид", "Madrid", "national_capital"],
      ["barcelona", "Барселона", "Barcelona", "relocation_city"],
      ["valencia", "Валенсия", "Valencia", "relocation_city"],
      ["alicante", "Аликанте", "Alicante", "relocation_city"],
      ["malaga", "Малага", "Malaga", "relocation_city"],
    ],
  },
  {
    countryCode: "DE", name: ["Германия", "Germany"], localeHints: ["de", "en"],
    cities: [
      ["berlin", "Берлин", "Berlin", "national_capital"],
      ["munich", "Мюнхен", "Munich", "relocation_city"],
      ["hamburg", "Гамбург", "Hamburg", "relocation_city"],
      ["frankfurt-am-main", "Франкфурт-на-Майне", "Frankfurt am Main", "relocation_city"],
      ["dusseldorf", "Дюссельдорф", "Dusseldorf", "relocation_city"],
    ],
  },
  {
    countryCode: "RS", name: ["Сербия", "Serbia"], localeHints: ["sr", "en"],
    cities: [
      ["belgrade", "Белград", "Belgrade", "national_capital"],
      ["novi-sad", "Нови-Сад", "Novi Sad", "relocation_city"],
      ["nis", "Ниш", "Nis", "relocation_city"],
      ["subotica", "Суботица", "Subotica", "relocation_city"],
      ["kragujevac", "Крагуевац", "Kragujevac", "relocation_city"],
    ],
  },
  {
    countryCode: "ME", name: ["Черногория", "Montenegro"], localeHints: ["cnr", "sr", "en"],
    cities: [
      ["podgorica", "Подгорица", "Podgorica", "national_capital"],
      ["budva", "Будва", "Budva", "relocation_city"],
      ["bar", "Бар", "Bar", "relocation_city"],
      ["herceg-novi", "Херцег-Нови", "Herceg Novi", "relocation_city"],
      ["tivat", "Тиват", "Tivat", "relocation_city"],
    ],
  },
  {
    countryCode: "GE", name: ["Грузия", "Georgia"], localeHints: ["ka", "en"],
    cities: [
      ["tbilisi", "Тбилиси", "Tbilisi", "national_capital"],
      ["batumi", "Батуми", "Batumi", "relocation_city"],
      ["kutaisi", "Кутаиси", "Kutaisi", "relocation_city"],
      ["rustavi", "Рустави", "Rustavi", "relocation_city"],
      ["poti", "Поти", "Poti", "relocation_city"],
    ],
  },
  {
    countryCode: "TR", name: ["Турция", "Türkiye"], localeHints: ["tr", "en"],
    cities: [
      ["ankara", "Анкара", "Ankara", "national_capital"],
      ["istanbul", "Стамбул", "Istanbul", "relocation_city"],
      ["izmir", "Измир", "Izmir", "relocation_city"],
      ["antalya", "Анталья", "Antalya", "relocation_city"],
      ["mersin", "Мерсин", "Mersin", "relocation_city"],
    ],
  },
  {
    countryCode: "AE", name: ["ОАЭ", "United Arab Emirates"], localeHints: ["ar", "en"],
    cities: [
      ["abu-dhabi", "Абу-Даби", "Abu Dhabi", "national_capital"],
      ["dubai", "Дубай", "Dubai", "relocation_city"],
      ["sharjah", "Шарджа", "Sharjah", "relocation_city"],
      ["ajman", "Аджман", "Ajman", "relocation_city"],
      ["ras-al-khaimah", "Рас-эль-Хайма", "Ras Al Khaimah", "relocation_city"],
    ],
  },
  {
    countryCode: "TH", name: ["Таиланд", "Thailand"], localeHints: ["th", "en"],
    cities: [
      ["bangkok", "Бангкок", "Bangkok", "national_capital"],
      ["chiang-mai", "Чиангмай", "Chiang Mai", "relocation_city"],
      ["phuket-city", "Пхукет", "Phuket City", "relocation_city"],
      ["pattaya", "Паттайя", "Pattaya", "relocation_city"],
      ["hua-hin", "Хуахин", "Hua Hin", "relocation_city"],
    ],
  },
] as const;

describe("demo relocation seed", () => {
  test("pins the exact subjective ordered 10 by 5 selection", () => {
    const seed = readDemoRelocationSeed();

    expect(seed.schemaVersion).toBe("demo-relocation-seed@1");
    expect(seed.purpose).toBe("subjective_ru_speaking_non_evidentiary_research_seed");
    expect(seed.countries.map((country) => ({
      countryCode: country.countryCode,
      name: [country.name.ru, country.name.en],
      localeHints: country.localeHints,
      cities: country.cities.map((city) => [
        city.cityId,
        city.name.ru,
        city.name.en,
        city.selectionRole,
      ]),
    }))).toEqual(EXPECTED);

    const targets = seed.countries.flatMap((country) =>
      country.cities.map((city) => `${country.countryCode}:${city.cityId}`));
    expect(targets).toHaveLength(50);
    expect(new Set(targets).size).toBe(50);
  });

  test("owns exact closed recursively frozen DTOs", () => {
    const seed = readDemoRelocationSeed();
    expect(Object.keys(seed)).toEqual(["schemaVersion", "purpose", "countries"]);
    for (const country of seed.countries) {
      expect(Object.keys(country)).toEqual(["countryCode", "name", "localeHints", "cities"]);
      expect(Object.keys(country.name)).toEqual(["ru", "en"]);
      for (const city of country.cities) {
        expect(Object.keys(city)).toEqual(["cityId", "name", "selectionRole"]);
        expect(Object.keys(city.name)).toEqual(["ru", "en"]);
      }
    }
    assertDeepFrozen(seed);

    const original = seed.countries[0].name.ru;
    expect(Reflect.set(seed.countries[0].name, "ru", "Изменено")).toBe(false);
    const mutableCountries = seed.countries as unknown as unknown[];
    expect(() => mutableCountries.push(seed.countries[0])).toThrow(TypeError);
    expect(readDemoRelocationSeed()).toBe(seed);
    expect(readDemoRelocationSeed().countries[0].name.ru).toBe(original);
  });

  test("contains no authoritative data fields or authority-layer imports", () => {
    const keys = collectKeys(readDemoRelocationSeed());
    for (const forbidden of [
      "url", "source", "fact", "color", "verdict", "package", "manifest",
      "evidence", "knowledge", "frontier", "revision", "status",
    ]) {
      expect([...keys].some((key) => key.toLowerCase().includes(forbidden))).toBe(false);
    }

    const source = readFileSync(
      new URL("../../src/research/demo-relocation-seed.ts", import.meta.url),
      "utf8",
    );
    expect(source.match(/^import .*$/gm) ?? []).toEqual([]);
  });
});

function assertDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function collectKeys(value: unknown, keys = new Set<string>()): ReadonlySet<string> {
  if (value === null || typeof value !== "object") return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectKeys(child, keys);
  }
  return keys;
}
