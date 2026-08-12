export interface PlaceFrontierSummaryInput {
  readonly shortlistSnapshot: {
    readonly markers: readonly {
      readonly country: { readonly countryCode: string };
      readonly formalVerdict: { readonly marker: "green" | "yellow" | "red" };
    }[];
  };
}

export function projectTerminalSummary(readModel: PlaceFrontierSummaryInput) {
  const nonRed = readModel.shortlistSnapshot.markers.filter(
    ({ formalVerdict }) => formalVerdict.marker !== "red",
  );
  const green = nonRed.filter(({ formalVerdict }) => formalVerdict.marker === "green").length;
  const yellow = nonRed.length - green;
  return {
    countries: nonRed.map(({ country }) => country.countryCode),
    composition: { green, yellow },
    stopCondition: nonRed.length === 5
      ? "five_non_red" as const
      : "installed_coverage_exhausted" as const,
    preliminary: yellow > 0 || nonRed.length < 5,
  };
}
