import type { SourceId } from "./contracts";

export const SOURCE_POLICIES = {
  "al-law-79": {
    navigationUrl: "https://qbz.gov.al/eli/ligj/2021/06/24/79",
    indexedSourceUrl: "http://qbz.gov.al/eli/ligj/2021/06/24/79",
    actType: "ligj",
    actDate: "2021-06-24",
    actNumber: "79",
  },
  "al-decision-858": {
    navigationUrl: "https://qbz.gov.al/eli/vendim/2021/12/29/858",
    indexedSourceUrl: "http://qbz.gov.al/eli/vendim/2021/12/29/858",
    actType: "vendim",
    actDate: "2021-12-29",
    actNumber: "858",
  },
  "cbr-eur": {
    url: "https://www.cbr.ru/scripts/XML_daily.asp",
    host: "www.cbr.ru",
    mediaType: "application/xml",
  },
  "boa-eur": {
    url: "https://www.bankofalbania.org/Markets/Official_exchange_rate/",
    host: "www.bankofalbania.org",
    mediaType: "text/html",
  },
  "tirana-urban-lines": {
    url: "https://tirana.al/pika-interesi/transporti/",
    host: "tirana.al",
    mediaType: "text/html",
    iframeHost: "gis.tirana.al",
  },
} as const satisfies Record<SourceId, object>;

export type QbzSourceId = "al-law-79" | "al-decision-858";
