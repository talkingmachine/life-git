export type DemoLocalizedName = Readonly<{
  ru: string;
  en: string;
}>;

export type DemoCitySeed = Readonly<{
  cityId: string;
  name: DemoLocalizedName;
  selectionRole: "national_capital" | "relocation_city";
}>;

export type DemoCountrySeed = Readonly<{
  countryCode: string;
  name: DemoLocalizedName;
  localeHints: readonly string[];
  cities: readonly [
    DemoCitySeed,
    DemoCitySeed,
    DemoCitySeed,
    DemoCitySeed,
    DemoCitySeed,
  ];
}>;

export type DemoRelocationSeed = Readonly<{
  schemaVersion: "demo-relocation-seed@1";
  purpose: "subjective_ru_speaking_non_evidentiary_research_seed";
  countries: readonly [
    DemoCountrySeed,
    DemoCountrySeed,
    DemoCountrySeed,
    DemoCountrySeed,
    DemoCountrySeed,
    DemoCountrySeed,
    DemoCountrySeed,
    DemoCountrySeed,
    DemoCountrySeed,
    DemoCountrySeed,
  ];
}>;

const COUNTRY_CODE = /^[A-Z]{2}$/;
const CITY_ID = /^[a-z]+(?:-[a-z]+)*$/;
const LOCALE_HINT = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const MAX_LABEL_BYTES = 128;
const MAX_LOCALE_HINT_BYTES = 16;

function name(ru: string, en: string): DemoLocalizedName {
  return Object.freeze({ ru, en });
}

function city(
  cityId: string,
  ru: string,
  en: string,
  selectionRole: DemoCitySeed["selectionRole"],
): DemoCitySeed {
  return Object.freeze({ cityId, name: name(ru, en), selectionRole });
}

function country(
  countryCode: string,
  ru: string,
  en: string,
  localeHints: readonly string[],
  cities: DemoCountrySeed["cities"],
): DemoCountrySeed {
  return Object.freeze({
    countryCode,
    name: name(ru, en),
    localeHints: Object.freeze([...localeHints]),
    cities: Object.freeze([...cities]) as DemoCountrySeed["cities"],
  });
}

const COUNTRIES = Object.freeze([
  country("SI", "Словения", "Slovenia", ["sl", "en"], [
    city("ljubljana", "Любляна", "Ljubljana", "national_capital"),
    city("maribor", "Марибор", "Maribor", "relocation_city"),
    city("koper", "Копер", "Koper", "relocation_city"),
    city("celje", "Целе", "Celje", "relocation_city"),
    city("kranj", "Крань", "Kranj", "relocation_city"),
  ]),
  country("PT", "Португалия", "Portugal", ["pt", "en"], [
    city("lisbon", "Лиссабон", "Lisbon", "national_capital"),
    city("porto", "Порту", "Porto", "relocation_city"),
    city("braga", "Брага", "Braga", "relocation_city"),
    city("coimbra", "Коимбра", "Coimbra", "relocation_city"),
    city("funchal", "Фуншал", "Funchal", "relocation_city"),
  ]),
  country("ES", "Испания", "Spain", ["es", "en"], [
    city("madrid", "Мадрид", "Madrid", "national_capital"),
    city("barcelona", "Барселона", "Barcelona", "relocation_city"),
    city("valencia", "Валенсия", "Valencia", "relocation_city"),
    city("alicante", "Аликанте", "Alicante", "relocation_city"),
    city("malaga", "Малага", "Malaga", "relocation_city"),
  ]),
  country("DE", "Германия", "Germany", ["de", "en"], [
    city("berlin", "Берлин", "Berlin", "national_capital"),
    city("munich", "Мюнхен", "Munich", "relocation_city"),
    city("hamburg", "Гамбург", "Hamburg", "relocation_city"),
    city("frankfurt-am-main", "Франкфурт-на-Майне", "Frankfurt am Main", "relocation_city"),
    city("dusseldorf", "Дюссельдорф", "Dusseldorf", "relocation_city"),
  ]),
  country("RS", "Сербия", "Serbia", ["sr", "en"], [
    city("belgrade", "Белград", "Belgrade", "national_capital"),
    city("novi-sad", "Нови-Сад", "Novi Sad", "relocation_city"),
    city("nis", "Ниш", "Nis", "relocation_city"),
    city("subotica", "Суботица", "Subotica", "relocation_city"),
    city("kragujevac", "Крагуевац", "Kragujevac", "relocation_city"),
  ]),
  country("ME", "Черногория", "Montenegro", ["cnr", "sr", "en"], [
    city("podgorica", "Подгорица", "Podgorica", "national_capital"),
    city("budva", "Будва", "Budva", "relocation_city"),
    city("bar", "Бар", "Bar", "relocation_city"),
    city("herceg-novi", "Херцег-Нови", "Herceg Novi", "relocation_city"),
    city("tivat", "Тиват", "Tivat", "relocation_city"),
  ]),
  country("GE", "Грузия", "Georgia", ["ka", "en"], [
    city("tbilisi", "Тбилиси", "Tbilisi", "national_capital"),
    city("batumi", "Батуми", "Batumi", "relocation_city"),
    city("kutaisi", "Кутаиси", "Kutaisi", "relocation_city"),
    city("rustavi", "Рустави", "Rustavi", "relocation_city"),
    city("poti", "Поти", "Poti", "relocation_city"),
  ]),
  country("TR", "Турция", "Türkiye", ["tr", "en"], [
    city("ankara", "Анкара", "Ankara", "national_capital"),
    city("istanbul", "Стамбул", "Istanbul", "relocation_city"),
    city("izmir", "Измир", "Izmir", "relocation_city"),
    city("antalya", "Анталья", "Antalya", "relocation_city"),
    city("mersin", "Мерсин", "Mersin", "relocation_city"),
  ]),
  country("AE", "ОАЭ", "United Arab Emirates", ["ar", "en"], [
    city("abu-dhabi", "Абу-Даби", "Abu Dhabi", "national_capital"),
    city("dubai", "Дубай", "Dubai", "relocation_city"),
    city("sharjah", "Шарджа", "Sharjah", "relocation_city"),
    city("ajman", "Аджман", "Ajman", "relocation_city"),
    city("ras-al-khaimah", "Рас-эль-Хайма", "Ras Al Khaimah", "relocation_city"),
  ]),
  country("TH", "Таиланд", "Thailand", ["th", "en"], [
    city("bangkok", "Бангкок", "Bangkok", "national_capital"),
    city("chiang-mai", "Чиангмай", "Chiang Mai", "relocation_city"),
    city("phuket-city", "Пхукет", "Phuket City", "relocation_city"),
    city("pattaya", "Паттайя", "Pattaya", "relocation_city"),
    city("hua-hin", "Хуахин", "Hua Hin", "relocation_city"),
  ]),
] as const);

const SEED: DemoRelocationSeed = Object.freeze({
  schemaVersion: "demo-relocation-seed@1",
  purpose: "subjective_ru_speaking_non_evidentiary_research_seed",
  countries: COUNTRIES,
});

validateSeed(SEED);

export function readDemoRelocationSeed(): DemoRelocationSeed {
  return SEED;
}

function validateSeed(seed: DemoRelocationSeed): void {
  if (
    seed.schemaVersion !== "demo-relocation-seed@1" ||
    seed.purpose !== "subjective_ru_speaking_non_evidentiary_research_seed" ||
    seed.countries.length !== 10
  ) {
    invalidSeed();
  }

  const countryCodes = new Set<string>();
  const targets = new Set<string>();
  for (const countrySeed of seed.countries) {
    if (
      !COUNTRY_CODE.test(countrySeed.countryCode) ||
      countryCodes.has(countrySeed.countryCode) ||
      !validName(countrySeed.name) ||
      countrySeed.localeHints.length === 0 ||
      countrySeed.localeHints.length > 3 ||
      countrySeed.cities.length !== 5
    ) {
      invalidSeed();
    }
    countryCodes.add(countrySeed.countryCode);

    const localeHints = new Set<string>();
    for (const localeHint of countrySeed.localeHints) {
      if (
        !LOCALE_HINT.test(localeHint) ||
        utf8Bytes(localeHint) > MAX_LOCALE_HINT_BYTES ||
        localeHints.has(localeHint)
      ) {
        invalidSeed();
      }
      localeHints.add(localeHint);
    }

    for (let index = 0; index < countrySeed.cities.length; index += 1) {
      const citySeed = countrySeed.cities[index]!;
      const expectedRole = index === 0 ? "national_capital" : "relocation_city";
      const target = `${countrySeed.countryCode}:${citySeed.cityId}`;
      if (
        !CITY_ID.test(citySeed.cityId) ||
        citySeed.selectionRole !== expectedRole ||
        !validName(citySeed.name) ||
        targets.has(target)
      ) {
        invalidSeed();
      }
      targets.add(target);
    }
  }

  if (countryCodes.size !== 10 || targets.size !== 50) invalidSeed();
}

function validName(value: DemoLocalizedName): boolean {
  return validLabel(value.ru) && validLabel(value.en);
}

function validLabel(value: string): boolean {
  return value.length > 0 && value.trim() === value &&
    utf8Bytes(value) <= MAX_LABEL_BYTES && !/[\u0000-\u001f]/.test(value);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function invalidSeed(): never {
  throw new Error("invalid_demo_seed");
}
