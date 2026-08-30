import { types } from "node:util";

import { canonicalJson, sha256Text } from "../integrity";
import type {
  SloveniaDemoCaptureAuthorityTrace,
  SloveniaDemoCaptureBinding,
  SloveniaDemoPackageRelationView,
} from "./slovenia-demo-package-bundle";

/**
 * Reviewed independently from the acquisition output.  There intentionally is
 * no writer for this object in production code.
 */
export interface SloveniaDemoPackagePolicyLock {
  readonly schemaVersion: "si-demo-city-policy-lock@1";
  readonly packageId: "si-demo-city-package";
  readonly packageSchemaVersion: "si-demo-city-package@1";
  readonly evidenceRulesVersion: "si-demo-city-evidence@1";
  readonly bundleManifestSha256: string;
  readonly installInputSha256: string;
  readonly relationView: SloveniaDemoPackageRelationView;
  readonly cityIds: readonly ["ljubljana"];
  readonly captures: readonly SloveniaDemoCaptureBinding[];
}

function mismatch(): never { throw new Error("integrity_mismatch"); }
function own<T>(borrowed: T): T {
  const active = new Set<object>();
  const visit = (value: unknown): unknown => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") { if (!Number.isFinite(value)) mismatch(); return value; }
    if (typeof value !== "object" || types.isProxy(value) || active.has(value) || Object.getOwnPropertySymbols(value).length !== 0) mismatch();
    const descriptors = Object.getOwnPropertyDescriptors(value); active.add(value);
    try {
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype || Object.keys(descriptors).length !== value.length + 1) mismatch();
        return value.map((item, index) => { const d = descriptors[String(index)]; if (!d || !("value" in d) || !d.enumerable) mismatch(); return visit(item); });
      }
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) mismatch();
      return Object.fromEntries(Object.entries(descriptors).map(([key, d]) => {
        if (key === "__proto__" || !("value" in d) || !d.enumerable) mismatch(); return [key, visit(d.value)];
      }));
    } finally { active.delete(value); }
  };
  return visit(borrowed) as T;
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value && !/[\u0000-\u001f]/.test(value);
}
function identifier(value: unknown): value is string {
  return text(value) && /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value);
}
function sha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length !== 0) mismatch();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== keys.length || Object.keys(descriptors).sort().some((key, index) => key !== [...keys].sort()[index]) ||
    Object.values(descriptors).some((descriptor) => !("value" in descriptor) || !descriptor.enumerable)) mismatch();
  return value as Record<string, unknown>;
}
function authorityTrace(value: unknown): SloveniaDemoCaptureAuthorityTrace {
  const trace = exact(value, value !== null && typeof value === "object" &&
    (value as Record<string, unknown>).kind === "direct_allowed_host"
    ? ["kind"]
    : ["kind", "parentArtifactId", "edgeKind"]);
  if (trace.kind === "direct_allowed_host") {
    return Object.freeze({ kind: "direct_allowed_host" });
  }
  if (trace.kind !== "delegated_document" || !identifier(trace.parentArtifactId) ||
    (trace.edgeKind !== "link" && trace.edgeKind !== "redirect")) mismatch();
  return Object.freeze({
    kind: "delegated_document",
    parentArtifactId: trace.parentArtifactId,
    edgeKind: trace.edgeKind,
  });
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value); for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

export function reconstructSloveniaDemoPackagePolicyLock(
  borrowed: unknown,
): SloveniaDemoPackagePolicyLock {
  const root = exact(own(borrowed), ["schemaVersion", "packageId", "packageSchemaVersion", "evidenceRulesVersion", "bundleManifestSha256", "installInputSha256", "relationView", "cityIds", "captures"]);
  if (root.schemaVersion !== "si-demo-city-policy-lock@1" || root.packageId !== "si-demo-city-package" ||
    root.packageSchemaVersion !== "si-demo-city-package@1" || root.evidenceRulesVersion !== "si-demo-city-evidence@1" || !sha(root.bundleManifestSha256) || !sha(root.installInputSha256)) mismatch();
  if (!Array.isArray(root.cityIds) || root.cityIds.length !== 1 || root.cityIds[0] !== "ljubljana") mismatch();
  if (!Array.isArray(root.captures)) mismatch();
  const captures = root.captures.map((value) => {
    const item = exact(value, [
      "artifactId", "publisherId", "sourceUrl", "sha256", "capturedAt", "authorityTrace",
    ]);
    let canonicalDate = false;
    try {
      canonicalDate = text(item.capturedAt) &&
        new Date(item.capturedAt).toISOString() === item.capturedAt;
    } catch {
      canonicalDate = false;
    }
    if (!identifier(item.artifactId) || !identifier(item.publisherId) ||
      !text(item.sourceUrl) || !item.sourceUrl.startsWith("https://") ||
      !sha(item.sha256) || !canonicalDate) mismatch();
    return Object.freeze({
      artifactId: item.artifactId,
      publisherId: item.publisherId,
      sourceUrl: item.sourceUrl,
      sha256: item.sha256,
      capturedAt: item.capturedAt,
      authorityTrace: authorityTrace(item.authorityTrace),
    });
  }).sort((a, b) => a.artifactId.localeCompare(b.artifactId));
  if (new Set(captures.map(({ artifactId }) => artifactId)).size !== captures.length) mismatch();
  return freeze({
    schemaVersion: "si-demo-city-policy-lock@1",
    packageId: "si-demo-city-package",
    packageSchemaVersion: "si-demo-city-package@1",
    evidenceRulesVersion: "si-demo-city-evidence@1",
    bundleManifestSha256: root.bundleManifestSha256,
    installInputSha256: root.installInputSha256,
    relationView: own(root.relationView) as SloveniaDemoPackageRelationView,
    cityIds: ["ljubljana"] as const,
    captures: captures as readonly SloveniaDemoCaptureBinding[],
  });
}

/** Test/review helper only; acquisition code must never derive or rewrite a lock. */
export function digestSloveniaDemoPolicyLock(lock: SloveniaDemoPackagePolicyLock): string {
  return sha256Text(canonicalJson(reconstructSloveniaDemoPackagePolicyLock(lock)));
}
