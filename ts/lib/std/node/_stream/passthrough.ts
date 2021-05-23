// Copyright Node.js contributors. All rights reserved. MIT License.
import Transform from "./transform";
import type { TransformOptions } from "./transform";
import type { Encodings } from "../_utils";

export default class PassThrough extends Transform {
  constructor(options?: TransformOptions) {
    super(options);
  }

  _transform(
    // deno-lint-ignore no-explicit-any
    chunk: any,
    _encoding: Encodings,
    // deno-lint-ignore no-explicit-any
    cb: (error?: Error | null, data?: any) => void,
  ) {
    cb(null, chunk);
  }
}
