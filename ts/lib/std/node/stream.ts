// Copyright Node.js contributors. All rights reserved.

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
// IN THE SOFTWARE.
import Duplex from "./_stream/duplex";
import eos from "./_stream/end_of_stream";
import PassThrough from "./_stream/passthrough";
import pipeline from "./_stream/pipeline";
import * as promises from "./_stream/promises";
import Readable from "./_stream/readable";
import Stream from "./_stream/stream";
import Transform from "./_stream/transform";
import Writable from "./_stream/writable";

// This is here because doing it in _stream/stream.ts created some circular dependency hell.
Stream.Readable = Readable;
Stream.Writable = Writable;
Stream.Duplex = Duplex;
Stream.Transform = Transform;
Stream.PassThrough = PassThrough;
Stream.pipeline = pipeline;
Stream.finished = eos;
Stream.promises = promises;
Stream.Stream = Stream;

export default Stream;
export {
  Duplex,
  eos as finished,
  PassThrough,
  pipeline,
  promises,
  Readable,
  Stream,
  Transform,
  Writable,
};
export const { _isUint8Array, _uint8ArrayToBuffer } = Stream;
