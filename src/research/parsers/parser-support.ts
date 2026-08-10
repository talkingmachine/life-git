import { createHash } from "node:crypto";

import type { ArtifactBytes, ClaimAnchor, ParserEntry } from "../contracts";

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function entryHasValidIntegrity<S extends string>(entry: ParserEntry<S>): boolean {
  return entry.artifacts.every((artifact) => sha256(artifact.bytes) === artifact.sha256);
}

export function artifactByRole<S extends string>(
  entry: ParserEntry<S>,
  role: string,
): ArtifactBytes | undefined {
  const matches = entry.artifacts.filter((artifact) => artifact.role === role);
  return matches.length === 1 ? matches[0] : undefined;
}

export function anchor(
  artifact: ArtifactBytes,
  locator: string,
  excerpt: string,
): ClaimAnchor {
  return {
    artifactId: artifact.artifactId,
    locator,
    excerptSha256: sha256(new TextEncoder().encode(excerpt)),
  };
}

export function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
