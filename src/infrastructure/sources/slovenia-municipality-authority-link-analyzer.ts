import { load } from "cheerio";
import { types } from "node:util";

const LINK_URL = "https://www.ljubljana.si/";
const IDENTITY_LABEL = "Mestna občina Ljubljana";
const MAX_BYTES = 2 * 1024 * 1024;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  "byteLength",
)?.get;

export type SloveniaMunicipalityAuthorityLinkEvidence = Readonly<{
  schemaVersion: "si-municipality-authority-link-evidence@1";
  analyzerVersion: "si-municipality-authority-link-html@1";
  parentPublisherHost: "www.gov.si";
  municipalityHost: "www.ljubljana.si";
  linkUrl: typeof LINK_URL;
  identityLabel: typeof IDENTITY_LABEL;
}>;

export function analyzeSloveniaMunicipalityAuthorityLinkHtml(
  bytes: Uint8Array,
): SloveniaMunicipalityAuthorityLinkEvidence {
  if (bytes === null || typeof bytes !== "object" || types.isProxy(bytes) ||
    !(bytes instanceof Uint8Array) || Object.getPrototypeOf(bytes) !== Uint8Array.prototype) invalid();
  if (typedArrayByteLength(bytes) > MAX_BYTES) invalid();
  try {
    const ownedBytes = new Uint8Array(bytes);
    const html = new TextDecoder("utf-8", { fatal: true }).decode(ownedBytes);
    const $ = load(html, { xml: { decodeEntities: false } });
    const identityAnchors = $("a").filter((_, anchor) =>
      normalizeText($(anchor).text()) === IDENTITY_LABEL);
    const identityAnchor = $(identityAnchors[0]);
    if (identityAnchors.length !== 1 ||
      identityAnchor.find("script,style,noscript,template").length !== 0 ||
      identityAnchor.parents("script,style,noscript,template").length !== 0 ||
      identityAnchor.attr("href") !== LINK_URL) invalid();
    return Object.freeze({
      schemaVersion: "si-municipality-authority-link-evidence@1",
      analyzerVersion: "si-municipality-authority-link-html@1",
      parentPublisherHost: "www.gov.si",
      municipalityHost: "www.ljubljana.si",
      linkUrl: LINK_URL,
      identityLabel: IDENTITY_LABEL,
    });
  } catch {
    invalid();
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function typedArrayByteLength(value: Uint8Array): number {
  if (TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined) invalid();
  try {
    return TYPED_ARRAY_BYTE_LENGTH_GETTER.call(value) as number;
  } catch {
    invalid();
  }
}

function invalid(): never {
  throw new Error("slovenia_municipality_authority_link_invalid");
}
