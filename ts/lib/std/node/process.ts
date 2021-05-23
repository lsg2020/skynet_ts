// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
// Copyright Joyent, Inc. and Node.js contributors. All rights reserved. MIT license.
import { notImplemented } from "./_utils";
import EventEmitter from "./events";
import { fromFileUrl } from "../path/mod";

const notImplementedEvents = [
  "beforeExit",
  "disconnect",
  "message",
  "multipleResolves",
  "rejectionHandled",
  "SIGBREAK",
  "SIGBUS",
  "SIGFPE",
  "SIGHUP",
  "SIGILL",
  "SIGINT",
  "SIGSEGV",
  "SIGTERM",
  "SIGWINCH",
  "uncaughtException",
  "uncaughtExceptionMonitor",
  "unhandledRejection",
  "warning",
];

/** https://nodejs.org/api/process.html#process_process_arch */
export const arch = Deno.build.arch;

// The first 2 items are placeholders.
// They will be overwritten by the below Object.defineProperty calls.
const argv = ["", "", ...Deno.args];
// Overwrites the 1st item with getter.
Object.defineProperty(argv, "0", {
  get() {
    return Deno.execPath();
  },
});
// Overwrites the 2nd item with getter.
Object.defineProperty(argv, "1", {
  get() {
    return fromFileUrl(Deno.mainModule);
  },
});

/** https://nodejs.org/api/process.html#process_process_chdir_directory */
export const chdir = Deno.chdir;

/** https://nodejs.org/api/process.html#process_process_cwd */
export const cwd = Deno.cwd;

//deno-lint-ignore ban-ts-comment
//@ts-ignore
const _env: {
  [Deno.customInspect]: () => string;
} = {};

Object.defineProperty(_env, Deno.customInspect, {
  enumerable: false,
  configurable: false,
  get: function () {
    return Deno.env.toObject();
  },
});

/**
 * https://nodejs.org/api/process.html#process_process_env
 * Requires env permissions
 * */
export const env: Record<string, string> = new Proxy(_env, {
  get(target: any, prop: any) {
    if (prop === Deno.customInspect) {
      return target[Deno.customInspect];
    }
    return Deno.env.get(String(prop));
  },
  ownKeys() {
    return Reflect.ownKeys(Deno.env.toObject());
  },
  set(_target: any, prop: any, value: any) {
    Deno.env.set(String(prop), String(value));
    return value;
  },
});

/** https://nodejs.org/api/process.html#process_process_exit_code */
export const exit = Deno.exit;

/** https://nodejs.org/api/process.html#process_process_nexttick_callback_args */
export function nextTick(this: unknown, cb: () => void): void;
export function nextTick<T extends Array<unknown>>(
  this: unknown,
  cb: (...args: T) => void,
  ...args: T
): void;
export function nextTick<T extends Array<unknown>>(
  this: unknown,
  cb: (...args: T) => void,
  ...args: T
) {
  if (args) {
    queueMicrotask(() => cb.call(this, ...args));
  } else {
    queueMicrotask(cb);
  }
}

/** https://nodejs.org/api/process.html#process_process_pid */
export const pid = Deno.pid;

/** https://nodejs.org/api/process.html#process_process_platform */
export const platform = Deno.build.os === "windows" ? "win32" : Deno.build.os;

/** https://nodejs.org/api/process.html#process_process_version */
export const version = `v${Deno.version.deno}`;

/** https://nodejs.org/api/process.html#process_process_versions */
export const versions = {
  node: Deno.version.deno,
  ...Deno.version,
};

class Process extends EventEmitter {
  constructor() {
    super();

    //This causes the exit event to be binded to the unload event
    window.addEventListener("unload", () => {
      //TODO(Soremwar)
      //Get the exit code from the unload event
      super.emit("exit", 0);
    });
  }

  /** https://nodejs.org/api/process.html#process_process_arch */
  arch = arch;

  /**
   * https://nodejs.org/api/process.html#process_process_argv
   * Read permissions are required in order to get the executable route
   * */
  argv = argv;

  /** https://nodejs.org/api/process.html#process_process_chdir_directory */
  chdir = chdir;

  /** https://nodejs.org/api/process.html#process_process_cwd */
  cwd = cwd;

  /** https://nodejs.org/api/process.html#process_process_exit_code */
  exit = exit;

  /**
   * https://nodejs.org/api/process.html#process_process_env
   * Requires env permissions
   * */
  env = env;

  /** https://nodejs.org/api/process.html#process_process_nexttick_callback_args */
  nextTick = nextTick;

  /** https://nodejs.org/api/process.html#process_process_events */
  //deno-lint-ignore ban-types
  on(event: typeof notImplementedEvents[number], listener: Function): never;
  on(event: "exit", listener: (code: number) => void): this;
  //deno-lint-ignore no-explicit-any
  on(event: string, listener: (...args: any[]) => void): this {
    if (notImplementedEvents.includes(event)) {
      notImplemented();
    }

    super.on(event, listener);

    return this;
  }

  /** https://nodejs.org/api/process.html#process_process_pid */
  pid = pid;

  /** https://nodejs.org/api/process.html#process_process_platform */
  platform = platform;

  removeAllListeners(_event: string): never {
    notImplemented();
  }

  removeListener(
    event: typeof notImplementedEvents[number],
    //deno-lint-ignore ban-types
    listener: Function,
  ): never;
  removeListener(event: "exit", listener: (code: number) => void): this;
  //deno-lint-ignore no-explicit-any
  removeListener(event: string, listener: (...args: any[]) => void): this {
    if (notImplementedEvents.includes(event)) {
      notImplemented();
    }

    super.removeListener("exit", listener);

    return this;
  }

  /**
   * Returns the current high-resolution real time in a [seconds, nanoseconds]
   * tuple.
   *
   * Note: You need to give --allow-hrtime permission to Deno to actually get
   * nanoseconds precision values. If you don't give 'hrtime' permission, the returned
   * values only have milliseconds precision.
   *
   * `time` is an optional parameter that must be the result of a previous process.hrtime() call to diff with the current time.
   *
   * These times are relative to an arbitrary time in the past, and not related to the time of day and therefore not subject to clock drift. The primary use is for measuring performance between intervals.
   * https://nodejs.org/api/process.html#process_process_hrtime_time
   */
  hrtime(time?: [number, number]): [number, number] {
    const milli = performance.now();
    const sec = Math.floor(milli / 1000);
    const nano = Math.floor(milli * 1_000_000 - sec * 1_000_000_000);
    if (!time) {
      return [sec, nano];
    }
    const [prevSec, prevNano] = time;
    return [sec - prevSec, nano - prevNano];
  }

  /** https://nodejs.org/api/process.html#process_process_stderr */
  get stderr() {
    return {
      fd: Deno.stderr.rid,
      get isTTY(): boolean {
        return Deno.isatty(this.fd);
      },
      pipe(_destination: Deno.Writer, _options: { end: boolean }): void {
        // TODO(JayHelton): to be implemented
        notImplemented();
      },
      // deno-lint-ignore ban-types
      write(_chunk: string | Uint8Array, _callback: Function): void {
        // TODO(JayHelton): to be implemented
        notImplemented();
      },
      // deno-lint-ignore ban-types
      on(_event: string, _callback: Function): void {
        // TODO(JayHelton): to be implemented
        notImplemented();
      },
    };
  }

  /** https://nodejs.org/api/process.html#process_process_stdin */
  get stdin() {
    return {
      fd: Deno.stdin.rid,
      get isTTY(): boolean {
        return Deno.isatty(this.fd);
      },
      read(_size: number): void {
        // TODO(JayHelton): to be implemented
        notImplemented();
      },
      // deno-lint-ignore ban-types
      on(_event: string, _callback: Function): void {
        // TODO(JayHelton): to be implemented
        notImplemented();
      },
    };
  }

  /** https://nodejs.org/api/process.html#process_process_stdout */
  get stdout() {
    return {
      fd: Deno.stdout.rid,
      get isTTY(): boolean {
        return Deno.isatty(this.fd);
      },
      pipe(_destination: Deno.Writer, _options: { end: boolean }): void {
        // TODO(JayHelton): to be implemented
        notImplemented();
      },
      // deno-lint-ignore ban-types
      write(_chunk: string | Uint8Array, _callback: Function): void {
        // TODO(JayHelton): to be implemented
        notImplemented();
      },
      // deno-lint-ignore ban-types
      on(_event: string, _callback: Function): void {
        // TODO(JayHelton): to be implemented
        notImplemented();
      },
    };
  }

  /** https://nodejs.org/api/process.html#process_process_version */
  version = version;

  /** https://nodejs.org/api/process.html#process_process_versions */
  versions = versions;
}

/** https://nodejs.org/api/process.html#process_process */
const process = new Process();

Object.defineProperty(process, Symbol.toStringTag, {
  enumerable: false,
  writable: true,
  configurable: false,
  value: "process",
});

export const removeListener = process.removeListener;
export const removeAllListeners = process.removeAllListeners;
export const stderr = process.stderr;
export const stdin = process.stdin;
export const stdout = process.stdout;

export default process;

//TODO(Soremwar)
//Remove on 1.0
//Kept for backwars compatibility with std
export { process };
