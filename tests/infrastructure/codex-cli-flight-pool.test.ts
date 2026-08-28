import { describe, expect, test, vi } from "vitest";

import { CodexFlightPool } from "../../src/infrastructure/codex-cli/flight-pool";

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function pool(now: () => number = () => 0): CodexFlightPool {
  return new CodexFlightPool({
    maximumConcurrency: 5,
    cooldownMs: 1_000,
    now,
    classifyPressure: (error) => error === "rate" ? "rate_limited" : undefined,
  });
}

describe("CodexFlightPool", () => {
  test("detaches one aborted waiter while preserving the leader result identity", async () => {
    // Break caught: forwarding a waiter signal to the operation lets one caller cancel shared work.
    const flights = pool();
    const leader = deferred<Readonly<{ readonly value: string }>>();
    const operation = vi.fn((signal: AbortSignal) => {
      void signal;
      return leader.promise;
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = flights.run({ key: "same", signal: firstController.signal, operation });
    const second = flights.run({ key: "same", signal: secondController.signal, operation });
    const result = Object.freeze({ value: "ok" });

    firstController.abort(new DOMException("detached", "AbortError"));
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(operation).toHaveBeenCalledOnce();
    expect(operation.mock.calls[0]?.[0]).not.toBe(firstController.signal);
    leader.resolve(result);

    await expect(second).resolves.toBe(result);
  });

  test("aborts the pool-owned leader when every waiter detaches", async () => {
    // Break caught: abandoned flights retain their process group after the last owner leaves.
    const flights = pool();
    const leader = deferred<string>();
    const controller = new AbortController();
    let leaderSignal!: AbortSignal;
    const running = flights.run({
      key: "all-gone",
      signal: controller.signal,
      operation: (signal) => {
        leaderSignal = signal;
        return leader.promise;
      },
    });

    controller.abort(new DOMException("gone", "AbortError"));
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(leaderSignal.aborted).toBe(true);
    leader.reject(leaderSignal.reason);
    await Promise.resolve();
  });

  test("limits distinct active leaders to five and starts queued work after terminal handoff", async () => {
    // Break caught: distinct keys can exceed the process quota or terminal cleanup leaves a key stuck.
    const flights = pool();
    const leaders = Array.from({ length: 6 }, () => deferred<string>());
    const operation = vi.fn((_: AbortSignal, index: number) => leaders[index]!.promise);
    const controllers = Array.from({ length: 6 }, () => new AbortController());
    const running = controllers.map((controller, index) => flights.run({
      key: `key-${index}`,
      signal: controller.signal,
      operation: (signal) => operation(signal, index),
    }));

    expect(operation).toHaveBeenCalledTimes(5);
    leaders[0]!.resolve("first");
    await expect(running[0]).resolves.toBe("first");
    expect(operation).toHaveBeenCalledTimes(6);
    leaders.slice(1).forEach((leader, index) => leader.resolve(`done-${index}`));
    await expect(Promise.all(running.slice(1))).resolves.toHaveLength(5);
  });

  test("shrinks 5 to 3 to 1 under pressure and recovers one step per cooldown", async () => {
    // Break caught: pressure either fails to reduce concurrency or restores all capacity at once.
    let clock = 0;
    const flights = pool(() => clock);
    const operation = vi.fn();
    const run = (key: string) => {
      const flight = deferred<string>();
      return {
        flight,
        promise: flights.run({
          key,
          signal: new AbortController().signal,
          operation: (signal) => {
            operation(signal);
            return flight.promise;
          },
        }),
      };
    };

    const first = run("rate-one");
    first.flight.reject("rate");
    await expect(first.promise).rejects.toBe("rate");
    const afterFirstPressure = [0, 1, 2, 3].map((index) => run(`three-${index}`));
    expect(operation).toHaveBeenCalledTimes(4);
    afterFirstPressure.slice(0, 3).forEach(({ flight }, index) => flight.resolve(`three-${index}`));
    await Promise.all(afterFirstPressure.slice(0, 3).map(({ promise }) => promise));
    afterFirstPressure[3]!.flight.resolve("three-3");
    await afterFirstPressure[3]!.promise;

    const second = run("rate-two");
    second.flight.reject("rate");
    await expect(second.promise).rejects.toBe("rate");
    const afterSecondPressure = [0, 1].map((index) => run(`one-${index}`));
    expect(operation).toHaveBeenCalledTimes(7);
    afterSecondPressure[0]!.flight.resolve("one-0");
    await afterSecondPressure[0]!.promise;
    expect(operation).toHaveBeenCalledTimes(8);
    afterSecondPressure[1]!.flight.resolve("one-1");
    await afterSecondPressure[1]!.promise;

    clock += 1_000;
    const recoveredOne = [0, 1, 2].map((index) => run(`recovered-three-${index}`));
    expect(operation).toHaveBeenCalledTimes(11);
    recoveredOne.forEach(({ flight }, index) => flight.resolve(`recovered-three-${index}`));
    await Promise.all(recoveredOne.map(({ promise }) => promise));
    clock += 1_000;
    const recoveredTwo = [0, 1, 2, 3, 4].map((index) => run(`recovered-five-${index}`));
    expect(operation).toHaveBeenCalledTimes(16);
    recoveredTwo.forEach(({ flight }, index) => flight.resolve(`recovered-five-${index}`));
    await Promise.all(recoveredTwo.map(({ promise }) => promise));
  });

  test("never caches a completed result across independent runs of the same key", async () => {
    // Break caught: stale completed flights are replayed instead of starting a new invocation.
    const flights = pool();
    const operation = vi.fn(async () => Object.freeze({ value: operation.mock.calls.length }));
    const first = await flights.run({ key: "reused", signal: new AbortController().signal, operation });
    const second = await flights.run({ key: "reused", signal: new AbortController().signal, operation });

    expect(operation).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });
});
