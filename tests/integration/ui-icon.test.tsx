// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { UiIcon } from "../../src/experience/components/UiIcon";

afterEach(cleanup);

it("renders the sanctioned icon map as decorative Phosphor SVG", () => {
  const { container } = render(
    <div>
      <UiIcon name="overview" />
      <UiIcon name="medical" size={18} />
      <UiIcon name="status-yellow" weight="duotone" />
    </div>,
  );

  expect(container.querySelectorAll("svg")).toHaveLength(3);
  expect(container.querySelector('[data-icon="overview"]')?.getAttribute("aria-hidden")).toBe("true");
  expect(container.textContent).toBe("");
});
