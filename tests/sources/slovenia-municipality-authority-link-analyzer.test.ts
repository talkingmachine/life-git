import { describe, expect, test } from "vitest";

import { analyzeSloveniaMunicipalityAuthorityLinkHtml } from
  "../../src/infrastructure/sources/slovenia-municipality-authority-link-analyzer";

const encoder = new TextEncoder();
const MAX_BYTES = 2 * 1024 * 1024;
const LINK_URL = "https://www.ljubljana.si/";
const IDENTITY_LABEL = "Mestna občina Ljubljana";
const FIXED_ERROR = "slovenia_municipality_authority_link_invalid";

function document(body: string): Uint8Array {
  return encoder.encode(`<!doctype html><html><body>${body}</body></html>`);
}

function validDocument(): Uint8Array {
  return document(`
    <a href="${LINK_URL}"><span> Mestna   občina\nLjubljana </span></a>
    <a href="${LINK_URL}">www.ljubljana.si</a>
  `);
}

function expectInvalid(value: unknown): void {
  expect(() => analyzeSloveniaMunicipalityAuthorityLinkHtml(value as Uint8Array))
    .toThrow(FIXED_ERROR);
}

describe("Slovenia municipality authority-link analyzer", () => {
  test("returns closed frozen evidence for the observed GOV.SI municipality link", () => {
    const bytes = validDocument();
    const original = new Uint8Array(bytes);

    const result = analyzeSloveniaMunicipalityAuthorityLinkHtml(bytes);

    expect(bytes).toEqual(original);
    expect(result).toEqual({
      schemaVersion: "si-municipality-authority-link-evidence@1",
      analyzerVersion: "si-municipality-authority-link-html@1",
      parentPublisherHost: "www.gov.si",
      municipalityHost: "www.ljubljana.si",
      linkUrl: "https://www.ljubljana.si/",
      identityLabel: "Mestna občina Ljubljana",
    });
    expect(Object.keys(result)).toEqual([
      "schemaVersion",
      "analyzerVersion",
      "parentPublisherHost",
      "municipalityHost",
      "linkUrl",
      "identityLabel",
    ]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test("accepts an exact two-mebibyte owned byte input", () => {
    const source = validDocument();
    const bytes = new Uint8Array(MAX_BYTES);
    bytes.fill(0x20);
    bytes.set(source);

    expect(analyzeSloveniaMunicipalityAuthorityLinkHtml(bytes).linkUrl).toBe(LINK_URL);
  });

  test("reads the Uint8Array internal length without invoking a shadow getter", () => {
    const bytes = validDocument();
    let getterReads = 0;
    Object.defineProperty(bytes, "byteLength", {
      configurable: true,
      get() {
        getterReads += 1;
        throw new Error("PRIVATE byteLength getter");
      },
    });

    expect(analyzeSloveniaMunicipalityAuthorityLinkHtml(bytes).linkUrl).toBe(LINK_URL);
    expect(getterReads).toBe(0);
  });

  test("rejects non-exact, proxied, and oversized byte inputs with the fixed error", () => {
    class DerivedBytes extends Uint8Array {}
    const oversizedSource = validDocument();
    const oversized = new Uint8Array(MAX_BYTES + 1);
    oversized.fill(0x20);
    oversized.set(oversizedSource);

    expectInvalid(new Proxy(validDocument(), {}));
    expectInvalid(new DerivedBytes(validDocument()));
    expectInvalid(validDocument().buffer);
    expectInvalid(oversized);
  });

  test("rejects malformed UTF-8 even when the exact link otherwise parses", () => {
    const valid = validDocument();
    const malformed = new Uint8Array(valid.length + 1);
    malformed.set(valid);
    malformed[valid.length] = 0xff;

    expectInvalid(malformed);
  });

  test.each([
    `<p>${IDENTITY_LABEL}</p>`,
    `<script>${IDENTITY_LABEL}</script>`,
    `<!-- <a href="${LINK_URL}">${IDENTITY_LABEL}</a> -->`,
    `<div data-href="${LINK_URL}">${IDENTITY_LABEL}</div>`,
    `<a href="${LINK_URL}">Mestna obcina Ljubljana</a>`,
  ])("rejects identity text that is not the exact identity anchor", (body) => {
    expectInvalid(document(body));
  });

  test.each([
    "http://www.ljubljana.si/",
    "https://user@www.ljubljana.si/",
    "https://www.ljubljana.si:8443/",
    "https://www.ljubljana.si.example/",
    "https://WWW.LJUBLJANA.SI/",
    "https://www.ljubljana.si&#x2f;",
    " / ",
  ])("rejects non-exact raw identity href %s", (href) => {
    expectInvalid(document(`<a href="${href}">${IDENTITY_LABEL}</a>`));
  });

  test.each(["script", "style", "noscript", "template"])(
    "rejects identity text supplied only by a nested %s element",
    (tag) => {
      expectInvalid(document(`<a href="${LINK_URL}"><${tag}>${IDENTITY_LABEL}</${tag}></a>`));
    },
  );

  test.each(["script", "style", "noscript", "template"])(
    "rejects an identity anchor inside an inert %s ancestor",
    (tag) => {
      expectInvalid(document(`<${tag}><a href="${LINK_URL}">${IDENTITY_LABEL}</a></${tag}>`));
    },
  );

  test("rejects duplicate identity anchors even when both href values are exact", () => {
    expectInvalid(document(`
      <a href="${LINK_URL}">${IDENTITY_LABEL}</a>
      <a href="${LINK_URL}">${IDENTITY_LABEL}</a>
    `));
  });
});
