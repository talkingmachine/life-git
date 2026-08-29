export type DemoLocalizedName = Readonly<{ ru: string; en: string }>;
export type DemoCitySeed = Readonly<{ cityId: string; name: DemoLocalizedName; selectionRole: "national_capital" | "relocation_city" }>;
export type DemoCountrySeed = Readonly<{ countryCode: string; name: DemoLocalizedName; localeHints: readonly string[]; cities: readonly [DemoCitySeed, DemoCitySeed, DemoCitySeed, DemoCitySeed, DemoCitySeed] }>;
export type DemoRelocationSeed = Readonly<{ schemaVersion: "demo-relocation-seed@1"; purpose: "subjective_ru_speaking_non_evidentiary_research_seed"; countries: readonly [DemoCountrySeed,DemoCountrySeed,DemoCountrySeed,DemoCountrySeed,DemoCountrySeed,DemoCountrySeed,DemoCountrySeed,DemoCountrySeed,DemoCountrySeed,DemoCountrySeed] }>;
const n=(ru:string,en:string)=>Object.freeze({ru,en}); const c=(cityId:string,ru:string,en:string,selectionRole:DemoCitySeed["selectionRole"])=>Object.freeze({cityId,name:n(ru,en),selectionRole});
const country=(countryCode:string,ru:string,en:string,localeHints:readonly string[],cities:readonly [DemoCitySeed,DemoCitySeed,DemoCitySeed,DemoCitySeed,DemoCitySeed])=>Object.freeze({countryCode,name:n(ru,en),localeHints:Object.freeze([...localeHints]),cities:Object.freeze(cities)}) as DemoCountrySeed;
const SEED=Object.freeze({schemaVersion:"demo-relocation-seed@1",purpose:"subjective_ru_speaking_non_evidentiary_research_seed",countries:Object.freeze([
country("SI","Словения","Slovenia",["sl","en"],[c("ljubljana","Любляна","Ljubljana","national_capital"),c("maribor","Марибор","Maribor","relocation_city"),c("koper","Копер","Koper","relocation_city"),c("celje","Целе","Celje","relocation_city"),c("kranj","Крань","Kranj","relocation_city")]),
country("PT","Португалия","Portugal",["pt","en"],[c("lisbon","Лиссабон","Lisbon","national_capital"),c("porto","Порту","Porto","relocation_city"),c("braga","Брага","Braga","relocation_city"),c("coimbra","Коимбра","Coimbra","relocation_city"),c("funchal","Фуншал","Funchal","relocation_city")]),
country("ES","Испания","Spain",["es","en"],[c("madrid","Мадрид","Madrid","national_capital"),c("barcelona","Барселона","Barcelona","relocation_city"),c("valencia","Валенсия","Valencia","relocation_city"),c("alicante","Аликанте","Alicante","relocation_city"),c("malaga","Малага","Malaga","relocation_city")]),
country("DE","Германия","Germany",["de","en"],[c("berlin","Берлин","Berlin","national_capital"),c("munich","Мюнхен","Munich","relocation_city"),c("hamburg","Гамбург","Hamburg","relocation_city"),c("frankfurt-am-main","Франкфурт-на-Майне","Frankfurt am Main","relocation_city"),c("dusseldorf","Дюссельдорф","Dusseldorf","relocation_city")]),
country("RS","Сербия","Serbia",["sr","en"],[c("belgrade","Белград","Belgrade","national_capital"),c("novi-sad","Нови-Сад","Novi Sad","relocation_city"),c("nis","Ниш","Nis","relocation_city"),c("subotica","Суботица","Subotica","relocation_city"),c("kragujevac","Крагуевац","Kragujevac","relocation_city")]),
country("ME","Черногория","Montenegro",["cnr","sr","en"],[c("podgorica","Подгорица","Podgorica","national_capital"),c("budva","Будва","Budva","relocation_city"),c("bar","Бар","Bar","relocation_city"),c("herceg-novi","Херцег-Нови","Herceg Novi","relocation_city"),c("tivat","Тиват","Tivat","relocation_city")]),
country("GE","Грузия","Georgia",["ka","en"],[c("tbilisi","Тбилиси","Tbilisi","national_capital"),c("batumi","Батуми","Batumi","relocation_city"),c("kutaisi","Кутаиси","Kutaisi","relocation_city"),c("rustavi","Рустави","Rustavi","relocation_city"),c("poti","Поти","Poti","relocation_city")]),
country("TR","Турция","Türkiye",["tr","en"],[c("ankara","Анкара","Ankara","national_capital"),c("istanbul","Стамбул","Istanbul","relocation_city"),c("izmir","Измир","Izmir","relocation_city"),c("antalya","Анталья","Antalya","relocation_city"),c("mersin","Мерсин","Mersin","relocation_city")]),
country("AE","ОАЭ","United Arab Emirates",["ar","en"],[c("abu-dhabi","Абу-Даби","Abu Dhabi","national_capital"),c("dubai","Дубай","Dubai","relocation_city"),c("sharjah","Шарджа","Sharjah","relocation_city"),c("ajman","Аджман","Ajman","relocation_city"),c("ras-al-khaimah","Рас-эль-Хайма","Ras Al Khaimah","relocation_city")]),
country("TH","Таиланд","Thailand",["th","en"],[c("bangkok","Бангкок","Bangkok","national_capital"),c("chiang-mai","Чиангмай","Chiang Mai","relocation_city"),c("phuket-city","Пхукет","Phuket City","relocation_city"),c("pattaya","Паттайя","Pattaya","relocation_city"),c("hua-hin","Хуахин","Hua Hin","relocation_city")]),
] as const)} as const);
function validateSeed(seed: DemoRelocationSeed): void {
  if (seed.countries.length !== 10 || new Set(seed.countries.map(({ countryCode }) => countryCode)).size !== 10) throw new Error("invalid_demo_seed");
  const targets = new Set<string>();
  for (const country of seed.countries) {
    if (!/^[A-Z]{2}$/.test(country.countryCode) || country.cities.length !== 5 || country.cities[0].selectionRole !== "national_capital" || country.cities.filter((city) => city.selectionRole === "national_capital").length !== 1 || country.localeHints.length === 0 || new Set(country.localeHints).size !== country.localeHints.length) throw new Error("invalid_demo_seed");
    for (const city of country.cities) {
      if (!/^[a-z]+(?:-[a-z]+)*$/.test(city.cityId) || city.name.ru.length === 0 || city.name.en.length === 0 || city.name.ru.length > 128 || city.name.en.length > 128 || targets.has(`${country.countryCode}:${city.cityId}`)) throw new Error("invalid_demo_seed");
      targets.add(`${country.countryCode}:${city.cityId}`);
    }
  }
  if (targets.size !== 50) throw new Error("invalid_demo_seed");
}
validateSeed(SEED);
export function readDemoRelocationSeed(): DemoRelocationSeed { return SEED; }
