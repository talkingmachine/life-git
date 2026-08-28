import { describe, expect, test } from "vitest";

import { parseSupportedCodexCliVersion } from "../../src/infrastructure/codex-cli/policy";

describe("parseSupportedCodexCliVersion", () => {
  test("accepts the supported alpha family", () => {
    expect(parseSupportedCodexCliVersion("codex-cli 0.149.0-alpha.4\n"))
      .toBe("codex-cli 0.149.0-alpha.4");
    expect(parseSupportedCodexCliVersion("codex-cli 0.149.0-alpha.17\n"))
      .toBe("codex-cli 0.149.0-alpha.17");
  });

  test.each(["codex-cli 0.149.0-alpha.3\n", "codex-cli 0.149.0-alpha.4", "codex-cli 0.150.0-alpha.4\n"])(
    "rejects unsupported version output %j", (stdout) => {
      expect(() => parseSupportedCodexCliVersion(stdout)).toThrowError("codex_version_mismatch");
    },
  );
});
