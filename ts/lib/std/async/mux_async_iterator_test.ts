// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import { assertEquals, assertThrowsAsync } from "../testing/asserts";
import { MuxAsyncIterator } from "./mux_async_iterator";

async function* gen123(): AsyncIterableIterator<number> {
  yield 1;
  yield 2;
  yield 3;
}

async function* gen456(): AsyncIterableIterator<number> {
  yield 4;
  yield 5;
  yield 6;
}

async function* genThrows(): AsyncIterableIterator<number> {
  yield 7;
  throw new Error("something went wrong");
}

Deno.test("[async] MuxAsyncIterator", async function () {
  const mux = new MuxAsyncIterator<number>();
  mux.add(gen123());
  mux.add(gen456());
  const results = new Set();
  for await (const value of mux) {
    results.add(value);
  }
  assertEquals(results.size, 6);
});

Deno.test({
  name: "[async] MuxAsyncIterator throws",
  async fn() {
    const mux = new MuxAsyncIterator<number>();
    mux.add(gen123());
    mux.add(genThrows());
    const results = new Set();
    await assertThrowsAsync(
      async () => {
        for await (const value of mux) {
          results.add(value);
        }
      },
      Error,
      "something went wrong",
    );
  },
});
