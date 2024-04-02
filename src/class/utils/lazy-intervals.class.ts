// Import Node.js Dependencies
import timers from "node:timers/promises";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

export interface LazyIntervalsOptions {
  callback: (signal: AbortSignal) => Promise<void>;
  timers?: number;
  state?: boolean;
}

export class LazyIntervals extends EventEmitter {
  timer: number;
  state: boolean;
  callback: (signal: AbortSignal) => Promise<void>;

  streamIntervals: Readable;

  #currentTask: AbortController | null = null;

  constructor(options: LazyIntervalsOptions) {
    super();

    Object.assign(this, options);

    this.state = options.state ?? false;
    this.timer = options.timers ?? 60_000;

    this.on("state", (state: boolean) => {
      this.state = state;

      if (this.#currentTask !== null && this.state === false) {
        this.#currentTask.abort();
        this.#currentTask = null;

        return;
      }
    });

    this.streamIntervals = Readable.from(this[Symbol.asyncIterator]()).resume();
  }

  close() {
    this.streamIntervals.destroy();
  }

  async* [Symbol.asyncIterator]() {
    const intervals = timers.setInterval(this.timer, async() => {
      if (!this.state) {
        return;
      }

      this.#currentTask = new AbortController();
      const signal = this.#currentTask.signal;

      try {
        await this.callback(signal);
      }
      finally {
        if (!signal.aborted) {
          this.#currentTask.abort();
        }
        this.#currentTask = null;
      }
    });

    for await (const intervalCb of intervals) {
      yield intervalCb();
    }
  }
}
