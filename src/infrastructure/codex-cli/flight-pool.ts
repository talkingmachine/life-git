export type CodexPressure = "none" | "rate_limited" | "provider_transient" | "timeout";

const NATIVE_ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const NATIVE_REASON_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "reason")?.get;
const NATIVE_ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const NATIVE_REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;

export type CodexFlightPoolOptions = Readonly<{
  maximumConcurrency: 5;
  cooldownMs: number;
  now: () => number;
  classifyPressure: (error: unknown) => Exclude<CodexPressure, "none"> | undefined;
}>;

type Waiter<T> = {
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
  readonly detach: () => void;
};

type Flight<T> = {
  readonly key: string;
  readonly controller: AbortController;
  readonly operation: (leaderSignal: AbortSignal) => Promise<T>;
  readonly waiters: Set<Waiter<T>>;
  started: boolean;
  terminal: boolean;
  successor?: Flight<T>;
};

export class CodexFlightPool {
  private readonly flights = new Map<string, Flight<unknown>>();
  private readonly queued: Flight<unknown>[] = [];
  private activeLeaders = 0;
  private maximumActiveLeaders: 1 | 3 | 5;
  private lastCapacityChangeAt: number;

  constructor(private readonly options: CodexFlightPoolOptions) {
    this.maximumActiveLeaders = options.maximumConcurrency;
    this.lastCapacityChangeAt = options.now();
  }

  run<T>(input: Readonly<{
    key: string;
    signal: AbortSignal;
    operation: (leaderSignal: AbortSignal) => Promise<T>;
  }>): Promise<T> {
    if (signalAborted(input.signal)) return Promise.reject(signalReason(input.signal));

    this.recoverCapacity();
    let flight = this.flights.get(input.key) as Flight<T> | undefined;
    if (flight !== undefined && signalAborted(flight.controller.signal)) {
      if (flight.started) {
        if (flight.successor === undefined || signalAborted(flight.successor.controller.signal)) {
          flight.successor = this.createFlight(input.key, input.operation);
        }
        flight = flight.successor;
      } else {
        this.removeQueuedFlight(flight);
        this.flights.delete(input.key);
        flight = undefined;
      }
    }
    if (flight === undefined) {
      flight = this.createFlight(input.key, input.operation);
      this.flights.set(input.key, flight as Flight<unknown>);
      this.queued.push(flight as Flight<unknown>);
    }

    const waiter = this.attachWaiter(flight, input.signal);
    this.startQueuedFlights();
    return waiter;
  }

  /** Bounded operational state; deliberately excludes keys, prompts, and process identifiers. */
  diagnostics(): Readonly<{ activeLeaders: number; queuedFlights: number; effectiveCeiling: 1 | 3 | 5 }> {
    return Object.freeze({ activeLeaders: this.activeLeaders, queuedFlights: this.queued.length, effectiveCeiling: this.maximumActiveLeaders });
  }

  private createFlight<T>(key: string, operation: (leaderSignal: AbortSignal) => Promise<T>): Flight<T> {
    return {
      key,
      controller: new AbortController(),
      operation,
      waiters: new Set(),
      started: false,
      terminal: false,
    };
  }

  private attachWaiter<T>(flight: Flight<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const detach = (): void => {
        if (settled) return;
        settled = true;
        flight.waiters.delete(waiter);
        removeAbortListener(signal, onAbort);
        if (!flight.terminal && flight.waiters.size === 0 && !signalAborted(flight.controller.signal)) {
          flight.controller.abort(new DOMException("All flight waiters detached", "AbortError"));
        }
      };
      const onAbort = (): void => {
        const reason = signalReason(signal) ?? new DOMException("Aborted", "AbortError");
        detach();
        reject(reason);
      };
      const waiter: Waiter<T> = { resolve, reject, detach };
      flight.waiters.add(waiter);
      addAbortListener(signal, onAbort);
      if (signalAborted(signal)) onAbort();
    });
  }

  private startQueuedFlights(): void {
    this.recoverCapacity();
    while (this.activeLeaders < this.maximumActiveLeaders) {
      const flight = this.queued.shift();
      if (flight === undefined) return;
      if (signalAborted(flight.controller.signal)) {
        if (this.flights.get(flight.key) === flight) this.flights.delete(flight.key);
        continue;
      }
      flight.started = true;
      this.activeLeaders += 1;
      let operation: Promise<unknown>;
      try {
        operation = flight.operation(flight.controller.signal);
      } catch (error) {
        operation = Promise.reject(error);
      }
      void operation
        .then(
          (result) => this.handoffSuccess(flight, result),
          (error: unknown) => this.handoffFailure(flight, error),
        );
    }
  }

  private handoffSuccess<T>(flight: Flight<T>, result: T): void {
    this.activeLeaders -= 1;
    flight.terminal = true;
    for (const waiter of flight.waiters) {
      waiter.detach();
      waiter.resolve(result);
    }
    this.releaseFlight(flight);
  }

  private handoffFailure<T>(flight: Flight<T>, error: unknown): void {
    this.activeLeaders -= 1;
    flight.terminal = true;
    if (this.options.classifyPressure(error) !== undefined) {
      this.reduceCapacity();
    }
    for (const waiter of flight.waiters) {
      waiter.detach();
      waiter.reject(error);
    }
    this.releaseFlight(flight);
  }

  private releaseFlight<T>(flight: Flight<T>): void {
    if (this.flights.get(flight.key) === flight) this.flights.delete(flight.key);
    const successor = flight.successor;
    if (successor !== undefined && successor.waiters.size > 0 && !signalAborted(successor.controller.signal)) {
      this.flights.set(successor.key, successor as Flight<unknown>);
      this.queued.push(successor as Flight<unknown>);
    }
    this.startQueuedFlights();
  }

  private removeQueuedFlight<T>(flight: Flight<T>): void {
    const index = this.queued.indexOf(flight as Flight<unknown>);
    if (index >= 0) this.queued.splice(index, 1);
  }

  private reduceCapacity(): void {
    this.maximumActiveLeaders = this.maximumActiveLeaders === 5 ? 3 : 1;
    this.lastCapacityChangeAt = this.options.now();
  }

  private recoverCapacity(): void {
    if (this.maximumActiveLeaders === this.options.maximumConcurrency) return;
    if (this.options.now() - this.lastCapacityChangeAt < this.options.cooldownMs) return;
    this.maximumActiveLeaders = this.maximumActiveLeaders === 1 ? 3 : 5;
    this.lastCapacityChangeAt = this.options.now();
  }
}

function signalAborted(signal: AbortSignal): boolean {
  if (NATIVE_ABORTED_GETTER === undefined) throw new TypeError("invalid_abort_signal");
  return NATIVE_ABORTED_GETTER.call(signal) === true;
}

function signalReason(signal: AbortSignal): unknown {
  if (NATIVE_REASON_GETTER === undefined) throw new TypeError("invalid_abort_signal");
  return NATIVE_REASON_GETTER.call(signal);
}

function addAbortListener(signal: AbortSignal, listener: EventListener): void {
  Reflect.apply(NATIVE_ADD_EVENT_LISTENER, signal, ["abort", listener, { once: true }]);
}

function removeAbortListener(signal: AbortSignal, listener: EventListener): void {
  Reflect.apply(NATIVE_REMOVE_EVENT_LISTENER, signal, ["abort", listener]);
}
