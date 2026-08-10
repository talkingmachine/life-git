export function replaceRunUrl(runId: string): void {
  window.history.replaceState(
    window.history.state,
    "",
    `?run=${encodeURIComponent(runId)}`,
  );
}
