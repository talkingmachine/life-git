import { describe, expect, it } from "vitest";

import { getSloveniaDemoCityPackageDefinition } from "../../src/decision/slovenia-demo-city-policy";
import {
  SLOVENIA_DEMO_CITY_CATALOG_SCOPE_POLICY,
  SLOVENIA_DEMO_CITY_INCOMPLETE_COVERAGE,
  SLOVENIA_DEMO_CITY_PACKAGE_DEFINITION,
} from "../../src/research/slovenia-demo-city-package";

describe("Slovenia local demo package", () => {
  it("is an explicitly partial Ljubljana-only identity, separate from the blocked national package", () => {
    expect(SLOVENIA_DEMO_CITY_PACKAGE_DEFINITION).toMatchObject({
      packageId: "si-demo-city-package",
      packageSchemaVersion: "si-demo-city-package@1",
      evidenceRulesVersion: "si-demo-city-evidence@1",
    });
    expect(SLOVENIA_DEMO_CITY_CATALOG_SCOPE_POLICY).toBe("subjective-relocation-demo@1");
    expect(SLOVENIA_DEMO_CITY_INCOMPLETE_COVERAGE).toEqual({
      status: "incomplete", reasons: ["official_universe_partial"],
    });
  });

  it("returns a frozen beta identity", () => {
    const definition = getSloveniaDemoCityPackageDefinition();
    expect(definition.packageId).toBe("si-demo-city-package");
    expect(Object.isFrozen(definition)).toBe(true);
  });
});
