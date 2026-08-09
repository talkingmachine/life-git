// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LabPage from "../../src/app/lab/page";

describe("lab catalog", () => {
  it("keeps a neutral home for future experiments", () => {
    render(<LabPage />);

    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /лаборатория/i })).toBeTruthy();
    expect(screen.queryByText(/запустить исследование/i)).toBeNull();
  });
});
