// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import { assertEquals, assertThrowsAsync } from "../testing/asserts";
import { deferred } from "./deferred";

Deno.test("[async] deferred: resolve", async function () {
  const d = deferred<string>();
  d.resolve("🦕");
  assertEquals(await d, "🦕");
});

Deno.test("[async] deferred: reject", async function () {
  const d = deferred<number>();
  d.reject(new Error("A deno error 🦕"));
  await assertThrowsAsync(async () => {
    await d;
  });
});
