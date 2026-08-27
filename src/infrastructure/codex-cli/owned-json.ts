export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

const PROTOCOL_INVALID = "codex_protocol_invalid";

export function snapshotOwnedJson(value: unknown): JsonValue {
  return snapshot(value, new Set<object>());
}

function snapshot(value: unknown, ancestors: Set<object>): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw protocolInvalid();
  }
  if (typeof value !== "object") throw protocolInvalid();
  if (ancestors.has(value)) throw protocolInvalid();

  ancestors.add(value);
  try {
    return Array.isArray(value) ? snapshotArray(value, ancestors) : snapshotObject(value, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

function snapshotArray(value: unknown[], ancestors: Set<object>): readonly JsonValue[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) throw protocolInvalid();

  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes("length")) throw protocolInvalid();

  const copy = new Array<JsonValue>(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !isEnumerableDataDescriptor(descriptor)) throw protocolInvalid();
    copy[index] = snapshot(descriptor.value, ancestors);
  }
  return copy;
}

function snapshotObject(value: object, ancestors: Set<object>): JsonObject {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw protocolInvalid();

  const copy: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw protocolInvalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !isEnumerableDataDescriptor(descriptor)) throw protocolInvalid();
    Object.defineProperty(copy, key, {
      value: snapshot(descriptor.value, ancestors),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return copy;
}

function isEnumerableDataDescriptor(descriptor: PropertyDescriptor): descriptor is PropertyDescriptor & { value: unknown } {
  return descriptor.enumerable === true && "value" in descriptor;
}

function protocolInvalid(): Error {
  return new Error(PROTOCOL_INVALID);
}
