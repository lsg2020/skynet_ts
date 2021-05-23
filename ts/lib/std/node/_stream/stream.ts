// Copyright Node.js contributors. All rights reserved. MIT License.
import { Buffer } from "../buffer";
import type Duplex from "./duplex";
import type eos from "./end_of_stream";
import EventEmitter from "../events";
import type PassThrough from "./passthrough";
import type pipeline from "./pipeline";
import type * as promises from "./promises";
import type Readable from "./readable";
import type Transform from "./transform";
import type Writable from "./writable";
import { types } from "../util";

class Stream extends EventEmitter {
  constructor() {
    super();
  }

  static _isUint8Array = types.isUint8Array;
  static _uint8ArrayToBuffer = (chunk: Uint8Array) => Buffer.from(chunk);

  pipe(dest: Readable | Writable, options?: { end?: boolean }) {
    // deno-lint-ignore no-this-alias
    const source = this;

    //TODO(Soremwar)
    //isStdio exist on stdin || stdout only, which extend from Duplex
    //if (!dest._isStdio && (options?.end ?? true)) {
    //Find an alternative to be able to pipe streams to stdin & stdout
    //Port them as well?
    if (options?.end ?? true) {
      source.on("end", onend);
      source.on("close", onclose);
    }

    let didOnEnd = false;
    function onend() {
      if (didOnEnd) return;
      didOnEnd = true;

      // 'end' is only called on Writable streams
      (dest as Writable).end();
    }

    function onclose() {
      if (didOnEnd) return;
      didOnEnd = true;

      if (typeof dest.destroy === "function") dest.destroy();
    }

    // Don't leave dangling pipes when there are errors.
    function onerror(this: Stream, er: Error) {
      cleanup();
      if (this.listenerCount("error") === 0) {
        throw er; // Unhandled stream error in pipe.
      }
    }

    source.on("error", onerror);
    dest.on("error", onerror);

    // Remove all the event listeners that were added.
    function cleanup() {
      source.removeListener("end", onend);
      source.removeListener("close", onclose);

      source.removeListener("error", onerror);
      dest.removeListener("error", onerror);

      source.removeListener("end", cleanup);
      source.removeListener("close", cleanup);

      dest.removeListener("close", cleanup);
    }

    source.on("end", cleanup);
    source.on("close", cleanup);

    dest.on("close", cleanup);
    dest.emit("pipe", source);

    return dest;
  }

  static Readable: typeof Readable;
  static Writable: typeof Writable;
  static Duplex: typeof Duplex;
  static Transform: typeof Transform;
  static PassThrough: typeof PassThrough;
  static pipeline: typeof pipeline;
  static finished: typeof eos;
  static promises: typeof promises;
  static Stream: typeof Stream;
}

export default Stream;
