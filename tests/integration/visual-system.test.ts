import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const researchGlobeCss = readFileSync(
  resolve(process.cwd(), "src/experience/research-map/ResearchGlobe.module.css"),
  "utf8",
);

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rule(source: string, selector: string): string {
  const match = source.match(new RegExp(`${escaped(selector)}\\s*\\{([^{}]*)\\}`));
  if (match?.[1] === undefined) throw new Error(`Missing CSS rule: ${selector}`);
  return match[1];
}

function rules(source: string, selector: string): readonly string[] {
  return [...source.matchAll(new RegExp(`${escaped(selector)}\\s*\\{([^{}]*)\\}`, "g"))]
    .map((match) => match[1] ?? "");
}

function declaration(block: string, property: string): string {
  const match = block.match(new RegExp(`(?:^|;)\\s*${escaped(property)}\\s*:\\s*([^;]+)`));
  if (match?.[1] === undefined) throw new Error(`Missing CSS declaration: ${property}`);
  return match[1].trim();
}

function atRule(source: string, prelude: string): string {
  const start = source.indexOf(prelude);
  if (start === -1) throw new Error(`Missing CSS at-rule: ${prelude}`);
  const openingBrace = source.indexOf("{", start);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }
  throw new Error(`Unclosed CSS at-rule: ${prelude}`);
}

function rootColor(token: string): string {
  const value = declaration(rule(css, ":root"), token);
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Non-hex color token: ${token}`);
  return value;
}

function resolveColor(value: string): string {
  const token = value.match(/^var\((--[^)]+)\)$/)?.[1];
  return token === undefined ? value : rootColor(token);
}

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/../g)?.map((channel) => Number.parseInt(channel, 16) / 255);
  if (channels === undefined) throw new Error(`Invalid color: ${hex}`);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function contrast(foreground: string, background: string): number {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

describe("calm command center visual contracts", () => {
  it("uses borderless translucent glass for floating orbit panels", () => {
    const panel = rule(css, ".orbit-panel");
    const background = declaration(panel, "background");
    const blur = declaration(panel, "backdrop-filter");

    expect(declaration(panel, "border")).toBe("0");
    expect(background).toMatch(/rgba\([^)]*,\s*0\.[1-7][0-9]?\)/);
    expect(blur).toMatch(/blur\((?:1[8-9]|[2-9][0-9])px\)/);
  });

  it("uses the exact collapsed and expanded desktop rail widths", () => {
    const shell = rule(css, ".product-shell");

    expect(declaration(shell, "grid-template-columns")).toBe("80px minmax(0, 1fr)");
    expect(declaration(rule(css, '.product-shell[data-rail-expanded="true"]'), "grid-template-columns"))
      .toBe("240px minmax(0, 1fr)");
  });

  it("keeps bottom panels and city detail in separate desktop zones", () => {
    const telemetry = rule(css, ".overview-workspace__telemetry");
    const detailsImage = rule(css, ".destination-detail-panel__image");

    expect(declaration(telemetry, "left")).toContain("--orbit-profile-width");
    expect(declaration(telemetry, "right")).toContain("--orbit-details-width");
    expect(declaration(detailsImage, "height")).toMatch(/^clamp\(120px,/);
  });

  it("layers the shared 3D globe across the product workspace", () => {
    const workspace = rule(css, ".product-shell__workspace");
    const globe = rule(css, ".workspace-globe");
    const engine = rule(css, ".workspace-globe__engine");
    const context = rule(css, ".context-bar");
    const content = rule(css, ".product-shell__content");

    expect(declaration(workspace, "position")).toBe("relative");
    expect(declaration(workspace, "overflow")).toBe("clip");
    expect(declaration(globe, "position")).toBe("absolute");
    expect(declaration(globe, "inset")).toBe("0");
    expect(declaration(globe, "z-index")).toBe("0");
    expect(declaration(engine, "position")).toBe("absolute");
    expect(declaration(engine, "inset")).toBe("0");
    expect(["relative", "sticky"]).toContain(declaration(context, "position"));
    expect(declaration(context, "z-index")).toBe("20");
    expect(declaration(content, "position")).toBe("relative");
    expect(declaration(content, "z-index")).toBe("2");
  });

  it("keeps the full-workspace Overview canvas transparent above the globe", () => {
    const overview = rule(css, ".overview-workspace--orbit");

    expect(declaration(overview, "background")).toBe("transparent");
  });

  it("lets collapsed globe markers pass through empty product content while preserving controls", () => {
    const content = rule(
      css,
      '.product-shell__workspace[data-globe-mode="collapsed"] .product-shell__content',
    );
    const controls = rule(
      css,
      '.product-shell__workspace[data-globe-mode="collapsed"] :is(.cold-start-comparator, .cold-start-journey__transport, .research-workspace__candidate, .research-workspace__progress, .research-workspace__retry)',
    );

    expect(declaration(content, "pointer-events")).toBe("none");
    expect(declaration(controls, "pointer-events")).toBe("auto");
    expect(css).not.toMatch(/\.cold-start-journey--collapsed\s*>\s*\.research-workspace\s*\{/);
  });

  it("does not retain obsolete globe or route-art selectors", () => {
    expect(css).not.toMatch(/\.orbit-globe|globe-arrival|\.research-map__art|\.research-map__airplane|route-arrival/);
  });

  it("places tablet Research status and retry panels in separate in-flow rows", () => {
    const tablet = atRule(css, "@media (min-width: 720px) and (max-width: 1099px)");
    const candidate = rule(tablet, ".research-workspace__candidate");
    const retry = rule(tablet, ".research-workspace__retry");

    expect(["relative", "static"]).toContain(declaration(candidate, "position"));
    expect(["relative", "static"]).toContain(declaration(retry, "position"));
    expect(declaration(candidate, "grid-row")).not.toBe(declaration(retry, "grid-row"));
  });

  it("places intermediate-desktop Research panels in collision-safe in-flow rows", () => {
    const intermediateDesktop = atRule(css, "@media (min-width: 1100px) and (max-width: 1279px)");
    const candidate = rule(intermediateDesktop, ".research-workspace__candidate");
    const retry = rule(intermediateDesktop, ".research-workspace__retry");

    expect(["relative", "static"]).toContain(declaration(candidate, "position"));
    expect(["relative", "static"]).toContain(declaration(retry, "position"));
    expect(declaration(candidate, "grid-row")).not.toBe(declaration(retry, "grid-row"));
  });

  it("flows Overview panels when the expanded rail narrows an intermediate workspace", () => {
    const intermediate = atRule(css, "@media (min-width: 900px) and (max-width: 1139px)");
    const overview = rule(
      intermediate,
      '.product-shell[data-rail-expanded="true"] .overview-workspace--orbit',
    );
    const panels = rule(
      intermediate,
      '.product-shell[data-rail-expanded="true"] :where(.route-candidate-panel, .compact-profile-panel, .destination-detail-panel, .overview-workspace__telemetry)',
    );

    expect(declaration(overview, "display")).toBe("grid");
    expect(declaration(overview, "min-height")).toBe("auto");
    expect(declaration(panels, "position")).toBe("relative");
    expect(declaration(panels, "width")).toBe("100%");
  });

  it("places every mobile Research candidate element without grid collisions", () => {
    const mobile = atRule(css, "@media (max-width: 719px)");
    const status = rule(mobile, ".research-workspace__candidate-item .research-workspace__status-icon");
    const route = rule(mobile, ".research-workspace__candidate-item .research-workspace__route");
    const state = rule(mobile, ".research-workspace__candidate-item .research-workspace__state-label");
    const disclosure = rule(mobile, ".research-workspace__candidate-item .research-workspace__disclosure-icon");

    expect(declaration(status, "grid-column")).toBe("1");
    expect(declaration(route, "grid-column")).toBe("2");
    expect(declaration(state, "grid-column")).toBe("2");
    expect(declaration(disclosure, "grid-column")).toBe("3");
    expect(declaration(route, "grid-row")).not.toBe(declaration(state, "grid-row"));
  });

  it("does not bind ordinary budget meters to verification-state colors", () => {
    const budgetRules = css.match(/\.budget-flow__bar[^{}]*meter\s*\{[^{}]*\}/g) ?? [];
    expect(budgetRules.join("\n")).not.toMatch(/var\(--(?:success|warning|danger)\)/);
  });

  it("maintains a two-color focus treatment with three-to-one contrast", () => {
    const focus = rule(css, ":focus-visible");
    const inner = rootColor("--focus-inner");
    const outer = rootColor("--focus-outer");

    expect(focus).toContain("var(--focus-inner)");
    expect(focus).toContain("var(--focus-outer)");
    expect(contrast(outer, rootColor("--surface"))).toBeGreaterThanOrEqual(3);
    expect(contrast(outer, rootColor("--canvas"))).toBeGreaterThanOrEqual(3);
    expect(contrast(inner, rootColor("--accent"))).toBeGreaterThanOrEqual(3);
  });

  it.each([
    [".budget-flow__bar", "--surface-subtle"],
    [".evidence-passport article li", "--surface-subtle"],
    [".context-bar__status", "--surface-subtle"],
    [".context-bar__status--yellow", "--warning-soft"],
    [".research-workspace__candidate-item--yellow .research-workspace__status-icon", "--warning-soft"],
  ])("keeps small text in %s at four-and-a-half-to-one contrast", (selector, backgroundToken) => {
    const foreground = resolveColor(declaration(rule(css, selector), "color"));
    expect(contrast(foreground, rootColor(backgroundToken))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps every responsive navigation label declaration at twelve pixels or larger", () => {
    const fontSizes = rules(css, ".navigation-rail__destination")
      .map((block) => declaration(block, "font-size"))
      .map((value) => value.endsWith("rem") ? Number.parseFloat(value) * 16 : Number.parseFloat(value));

    expect(fontSizes).toHaveLength(3);
    expect(Math.min(...fontSizes)).toBeGreaterThanOrEqual(12);
  });

  it("restores visible navigation labels in the mobile bottom bar", () => {
    const mobile = atRule(css, "@media (max-width: 719px)");
    const label = rule(mobile, ".navigation-rail__label");

    expect(declaration(label, "position")).toBe("static !important");
    expect(declaration(label, "width")).toBe("100% !important");
    expect(declaration(label, "height")).toBe("auto !important");
    expect(declaration(label, "clip")).toBe("auto !important");
  });

  it("does not synthesize Unicode disclosure controls in CSS", () => {
    const evidenceRules = rules(css, ".evidence-passport__technical > summary::after");
    expect(evidenceRules.join("\n")).not.toMatch(/content\s*:\s*["'][+−]["']/u);
  });

  it("keeps direct destination CSS2D markers hit-testable without making origins interactive", () => {
    const marker = rule(researchGlobeCss, ".cityBalloon");
    const origin = rule(researchGlobeCss, ".cityBalloonOrigin");

    expect(researchGlobeCss).not.toContain(".cityBalloonAnchor");
    expect(declaration(marker, "pointer-events")).toBe("auto");
    expect(declaration(marker, "translate")).toBe("0 calc(-50% - 0.34rem)");
    expect(marker).not.toMatch(/(?:^|;)\s*(?:bottom|left|transform)\s*:/);
    expect(declaration(origin, "pointer-events")).toBe("none");
  });
});
