export function replaceRunUrl(runId: string): void {
  window.history.replaceState(
    window.history.state,
    "",
    `?run=${encodeURIComponent(runId)}`,
  );
}

export function replaceColdStartRunUrl(runId: string, profileId: string): void {
  window.history.replaceState(
    window.history.state,
    "",
    `?flow=cold-start&run=${encodeURIComponent(runId)}&profile=${encodeURIComponent(profileId)}`,
  );
}

export function replacePlaceFrontierRunUrl(runId: string): void {
  window.history.replaceState(
    window.history.state,
    "",
    `?flow=place-frontier&run=${encodeURIComponent(runId)}`,
  );
}

export function replaceCountryResolutionRunUrl(runId: string): void {
  window.history.replaceState(
    window.history.state,
    "",
    `?flow=country-resolution&run=${encodeURIComponent(runId)}`,
  );
}

export function replaceCityFrontierRunUrl(runId: string): void {
  window.history.replaceState(
    window.history.state,
    "",
    `?flow=city-frontier&run=${encodeURIComponent(runId)}`,
  );
}
