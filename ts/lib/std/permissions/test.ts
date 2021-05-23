// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import { grant, grantOrThrow } from "./mod";
import { assert, assertEquals } from "../testing/asserts";

Deno.test({
  name: "grant basic",
  async fn() {
    assertEquals(await grant({ name: "net" }, { name: "env" }), [
      { name: "net" },
      { name: "env" },
    ]);
  },
});

Deno.test({
  name: "grant array",
  async fn() {
    assertEquals(await grant([{ name: "net" }, { name: "env" }]), [
      { name: "net" },
      { name: "env" },
    ]);
  },
});

Deno.test({
  name: "grant logic",
  async fn() {
    assert(await grant({ name: "net" }));
  },
});

Deno.test({
  name: "grantOrThrow basic",
  async fn() {
    await grantOrThrow({ name: "net" }, { name: "env" });
  },
});

Deno.test({
  name: "grantOrThrow array",
  async fn() {
    await grantOrThrow([{ name: "net" }, { name: "env" }]);
  },
});
