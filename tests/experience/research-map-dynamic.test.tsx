// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadResearchGlobeComponent } from "../../src/experience/components/ResearchMap";
import { MOSCOW_ORIGIN } from "../../src/experience/research-map/product-route";

afterEach(cleanup);

describe("ResearchMap dynamic globe loader", () => {
  it("converts an actual import rejection into the dynamic-import failure component", async () => {
    const importError = new Error("research globe chunk failed");
    const onUnavailable = vi.fn();
    const DynamicLoadFailure = await loadResearchGlobeComponent(
      () => Promise.reject(importError),
    );

    const { container } = render(
      <DynamicLoadFailure
        origin={MOSCOW_ORIGIN}
        overview={{ key: 0, coordinates: [MOSCOW_ORIGIN.coordinate] }}
        routes={[]}
        onFlightComplete={() => undefined}
        onReady={() => undefined}
        onUnavailable={onUnavailable}
      />,
    );

    await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith(
      "dynamic-import",
      importError,
    ));
    expect(container.firstChild).toBeNull();
  });
});
