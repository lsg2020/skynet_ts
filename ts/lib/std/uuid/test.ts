// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import { assert } from "../testing/asserts";
import { isNil, NIL_UUID } from "./mod";

Deno.test("[UUID] isNil", () => {
  const nil = NIL_UUID;
  const u = "582cbcff-dad6-4f28-888a-e062ae36bafc";
  assert(isNil(nil));
  assert(!isNil(u));
});
