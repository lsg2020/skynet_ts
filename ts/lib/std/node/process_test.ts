// deno-lint-ignore-file no-undef
// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.

import "./global";
import { assert, assertEquals, assertThrows } from "../testing/asserts";
import { stripColor } from "../fmt/colors";
import * as path from "../path/mod";
import { delay } from "../async/delay";
import { env } from "./process";

Deno.test({
  name: "process.cwd and process.chdir success",
  fn() {
    assertEquals(process.cwd(), Deno.cwd());

    const currentDir = Deno.cwd();

    const tempDir = Deno.makeTempDirSync();
    process.chdir(tempDir);
    assertEquals(
      Deno.realPathSync(process.cwd()),
      Deno.realPathSync(tempDir),
    );

    process.chdir(currentDir);
  },
});

Deno.test({
  name: "process.chdir failure",
  fn() {
    assertThrows(
      () => {
        process.chdir("non-existent-directory-name");
      },
      Deno.errors.NotFound,
      "file",
      // On every OS Deno returns: "No such file" except for Windows, where it's:
      // "The system cannot find the file specified. (os error 2)" so "file" is
      // the only common string here.
    );
  },
});

Deno.test({
  name: "process.version",
  fn() {
    assertEquals(typeof process, "object");
    assertEquals(typeof process.version, "string");
    assertEquals(typeof process.versions, "object");
    assertEquals(typeof process.versions.node, "string");
  },
});

Deno.test({
  name: "process.platform",
  fn() {
    assertEquals(typeof process.platform, "string");
  },
});

Deno.test({
  name: "process.arch",
  fn() {
    assertEquals(typeof process.arch, "string");
    // TODO(rsp): make sure that the arch strings should be the same in Node and Deno:
    assertEquals(process.arch, Deno.build.arch);
  },
});

Deno.test({
  name: "process.pid",
  fn() {
    assertEquals(typeof process.pid, "number");
    assertEquals(process.pid, Deno.pid);
  },
});

Deno.test({
  name: "process.on",
  async fn() {
    assertEquals(typeof process.on, "function");
    assertThrows(
      () => {
        process.on("uncaughtException", (_err: Error) => {});
      },
      Error,
      "implemented",
    );

    let triggered = false;
    process.on("exit", () => {
      triggered = true;
    });
    process.emit("exit");
    assert(triggered);

    const cwd = path.dirname(path.fromFileUrl(import.meta.url));

    const p = Deno.run({
      cmd: [
        Deno.execPath(),
        "run",
        "--quiet",
        "./testdata/process_exit.ts",
      ],
      cwd,
      stdout: "piped",
    });

    const decoder = new TextDecoder();
    const rawOutput = await p.output();
    assertEquals(
      stripColor(decoder.decode(rawOutput).trim()),
      "1\n2",
    );
    p.close();
  },
});

Deno.test({
  name: "process.argv",
  fn() {
    assert(Array.isArray(process.argv));
    assert(
      process.argv[0].match(/[^/\\]*deno[^/\\]*$/),
      "deno included in the file name of argv[0]",
    );
    assertEquals(
      process.argv[1],
      path.fromFileUrl(Deno.mainModule),
    );
    // argv supports array methods.
    assert(Array.isArray(process.argv.slice(2)));
    assertEquals(process.argv.indexOf(Deno.execPath()), 0);
    assertEquals(process.argv.indexOf(path.fromFileUrl(Deno.mainModule)), 1);
  },
});

Deno.test({
  name: "process.env",
  fn() {
    Deno.env.set("HELLO", "WORLD");

    assertEquals(typeof (process.env.HELLO), "string");
    assertEquals(process.env.HELLO, "WORLD");

    assertEquals(typeof env.HELLO, "string");
    assertEquals(env.HELLO, "WORLD");
  },
});

Deno.test({
  name: "process.stdin",
  fn() {
    assertEquals(typeof process.stdin.fd, "number");
    assertEquals(process.stdin.fd, Deno.stdin.rid);
    // TODO(jayhelton) Uncomment out this assertion once PTY is supported
    //assert(process.stdin.isTTY);
  },
});

Deno.test({
  name: "process.stdout",
  fn() {
    assertEquals(typeof process.stdout.fd, "number");
    assertEquals(process.stdout.fd, Deno.stdout.rid);
    // TODO(jayhelton) Uncomment out this assertion once PTY is supported
    // assert(process.stdout.isTTY);
  },
});

Deno.test({
  name: "process.stderr",
  fn() {
    assertEquals(typeof process.stderr.fd, "number");
    assertEquals(process.stderr.fd, Deno.stderr.rid);
    // TODO(jayhelton) Uncomment out this assertion once PTY is supported
    // assert(process.stderr.isTTY);
  },
});

Deno.test({
  name: "process.nextTick",
  async fn() {
    let withoutArguments = false;
    process.nextTick(() => {
      withoutArguments = true;
    });

    const expected = 12;
    let result;
    process.nextTick((x: number) => {
      result = x;
    }, 12);

    await delay(10);
    assert(withoutArguments);
    assertEquals(result, expected);
  },
});

Deno.test({
  name: "process.hrtime",
  fn() {
    const [sec0, nano0] = process.hrtime();
    // seconds and nano seconds are positive integers.
    assert(sec0 > 0);
    assert(Number.isInteger(sec0));
    assert(nano0 > 0);
    assert(Number.isInteger(nano0));

    const [sec1, nano1] = process.hrtime();
    // the later call returns bigger value
    assert(sec1 >= sec0);
    assert(nano1 > nano0);

    const [sec2, nano2] = process.hrtime([sec1, nano1]);
    // the difference of the 2 calls is a small positive value.
    assertEquals(sec2, 0);
    assert(nano2 > 0);
  },
});
