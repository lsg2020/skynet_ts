// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import { assertEquals } from "../testing/asserts";
import * as url from "./url";

Deno.test({
  name: "[url] URL",
  fn() {
    assertEquals(url.URL, URL);
  },
});
