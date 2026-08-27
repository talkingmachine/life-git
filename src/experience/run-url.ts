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
