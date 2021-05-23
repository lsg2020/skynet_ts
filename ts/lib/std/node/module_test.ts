// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "../testing/asserts";

import * as path from "../path/mod";
import { createRequire } from "./module";

const moduleDir = path.dirname(path.fromFileUrl(import.meta.url));
const testdataDir = path.resolve(moduleDir, path.join("_fs", "testdata"));

const require = createRequire(import.meta.url);

Deno.test("requireSuccess", function () {
  // Relative to import.meta.url
  const result = require("./_module/cjs/cjs_a.js");
  assert("helloA" in result);
  assert("helloB" in result);
  assert("C" in result);
  assert("leftPad" in result);
  assertEquals(result.helloA(), "A");
  assertEquals(result.helloB(), "B");
  assertEquals(result.C, "C");
  assertEquals(result.leftPad("pad", 4), " pad");
});

Deno.test("requireCycle", function () {
  const resultA = require("./_module/cjs/cjs_cycle_a");
  const resultB = require("./_module/cjs/cjs_cycle_b");
  assert(resultA);
  assert(resultB);
});

Deno.test("requireBuiltin", function () {
  const fs = require("fs");
  assert("readFileSync" in fs);
  const { readFileSync, isNull, extname } = require(
    "./_module/cjs/cjs_builtin",
  );

  const testData = path.relative(
    Deno.cwd(),
    path.join(testdataDir, "hello.txt"),
  );
  assertEquals(
    readFileSync(testData, { encoding: "utf8" }),
    "hello world",
  );
  assert(isNull(null));
  assertEquals(extname("index.html"), ".html");
});

Deno.test("requireIndexJS", function () {
  const { isIndex } = require("./_module/cjs");
  assert(isIndex);
});

Deno.test("requireNodeOs", function () {
  const os = require("os");
  assert(os.arch);
  assert(typeof os.arch() == "string");
});

Deno.test("requireStack", function () {
  const { hello } = require("./_module/cjs/cjs_throw");
  try {
    hello();
  } catch (e) {
    assertStringIncludes(e.stack, "/_module/cjs/cjs_throw.js");
  }
});

Deno.test("requireFileInSymlinkDir", () => {
  const { C } = require("./_module/cjs/dir");
  assertEquals(C, "C");
});

Deno.test("requireModuleWithConditionalExports", () => {
  const { red, blue } = require("./_module/cjs/cjs_conditional_exports");
  assert(typeof red === "function");
  assert(typeof blue === "function");
});

Deno.test("requireNodeJsNativeModules", () => {
  // Checks these exist and don't throw.
  require("assert");
  require("buffer");
  require("child_process");
  require("constants");
  require("crypto");
  require("events");
  require("fs");
  require("module");
  require("os");
  require("path");
  require("querystring");
  require("stream");
  require("string_decoder");
  require("timers");
  require("tty");
  require("url");
  require("util");

  // TODO(kt3k): add these modules when implemented
  // require("cluster");
  // require("console");
  // require("dgram");
  // require("dns");
  // require("http");
  // require("http2");
  // require("https");
  // require("net");
  // require("perf_hooks");
  // require("readline");
  // require("repl");
  // require("sys");
  // require("tls");
  // require("vm");
  // require("worker_threads");
  // require("zlib");
});

Deno.test("native modules are extensible", () => {
  const randomKey = "random-key";
  const randomValue = "random-value";
  const modNames = [
    "assert",
    "buffer",
    "child_process",
    "crypto",
    "events",
    "fs",
    "module",
    "os",
    "path",
    "querystring",
    "stream",
    "string_decoder",
    "timers",
    "url",
    "util",
  ];
  for (const name of modNames) {
    const mod = require(name);
    Object.defineProperty(mod, randomKey, {
      value: randomValue,
      configurable: true,
    });
    assertEquals(mod[randomKey], randomValue);
    delete mod[randomKey];
    assertEquals(mod[randomKey], undefined);
  }
});

Deno.test("Require file with shebang", () => {
  require("./testdata/shebang.js");
});

Deno.test("EventEmitter is exported correctly", () => {
  const EventEmitter = require("events");
  assertEquals(EventEmitter, EventEmitter.EventEmitter);
});
