import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

interface PackageManifest {
  readonly engines?: { readonly node?: string };
  readonly scripts: Record<string, string>;
}

describe("native runtime contract", () => {
  it("pins Node 24 before starting the app with native dependencies", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as PackageManifest;

    expect(manifest.engines?.node).toBe(">=24 <25");
    expect(manifest.scripts.predev).toBe("node scripts/require-node-24.mjs");
    expect(manifest.scripts.prestart).toBe("node scripts/require-node-24.mjs");
    expect(manifest.scripts.start).toBe("next start");
    expect(readFileSync(".node-version", "utf8").trim()).toBe("24.14.0");
    expect(readFileSync(".npmrc", "utf8").trim()).toBe("engine-strict=true");
  });
});
