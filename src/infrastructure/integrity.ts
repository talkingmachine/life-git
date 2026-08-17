import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { EvidenceIntegrity } from "../research/run";
import type { CityDecisionIntegrity } from "../decision/city-integrity";
import type { CityEvidenceReplayIntegrity } from "../research/city-evidence";

const SHA256_HEX = /^[a-f\d]{64}$/i;
const DECISION_CAPABILITIES = ["canonical", "hash"] as const;
const REPLAY_CAPABILITIES = ["canonical", "hash", "hashBytes"] as const;

function exactCapabilityReceiver(
  value: unknown,
  expected: readonly string[],
): value is CityDecisionIntegrity {
  if (value === null || typeof value !== "object") return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacSha256(value: string, key: string): string {
  if (key.length === 0) throw new Error("integrity_key_missing");
  return createHmac("sha256", key).update(value).digest("hex");
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

export function secureHexEqual(left: string, right: string): boolean {
  if (!isSha256Hex(left) || !isSha256Hex(right)) return false;
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

export function createEvidenceIntegrity(key: string): EvidenceIntegrity {
  if (key.length === 0) throw new Error("integrity_key_missing");
  return Object.freeze({
    canonical: canonicalJson,
    hash: sha256Text,
    sign: (value: string) => hmacSha256(value, key),
  });
}

export function createCityDecisionIntegrityView(
  integrity: CityDecisionIntegrity,
): CityDecisionIntegrity {
  const canonical = integrity.canonical;
  const hash = integrity.hash;
  const view: CityDecisionIntegrity = Object.freeze({
    canonical(this: unknown, value: unknown): string {
      const receiver = exactCapabilityReceiver(this, DECISION_CAPABILITIES) ? this : view;
      return canonical.call(receiver, value);
    },
    hash(this: unknown, canonicalText: string): string {
      const receiver = exactCapabilityReceiver(this, DECISION_CAPABILITIES) ? this : view;
      return hash.call(receiver, canonicalText);
    },
  });
  return view;
}

export function createCityEvidenceReplayIntegrity(
  integrity: CityDecisionIntegrity,
): CityEvidenceReplayIntegrity {
  const canonical = integrity.canonical;
  const hash = integrity.hash;
  const view: CityEvidenceReplayIntegrity = Object.freeze({
    canonical(this: unknown, value: unknown): string {
      const receiver = exactCapabilityReceiver(this, DECISION_CAPABILITIES) ||
        exactCapabilityReceiver(this, REPLAY_CAPABILITIES) ? this : view;
      return canonical.call(receiver, value);
    },
    hash(this: unknown, canonicalText: string): string {
      const receiver = exactCapabilityReceiver(this, DECISION_CAPABILITIES) ||
        exactCapabilityReceiver(this, REPLAY_CAPABILITIES) ? this : view;
      return hash.call(receiver, canonicalText);
    },
    hashBytes(bytes: Uint8Array): string {
      return createHash("sha256").update(bytes).digest("hex");
    },
  });
  return view;
}
