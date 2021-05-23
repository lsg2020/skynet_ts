// Copyright Node.js contributors. All rights reserved. MIT License.
import finished from "./end_of_stream";
import Readable from "./readable";
import Transform from "./transform";
import Writable from "./writable";
import { mustCall } from "../_utils";
import { assert, fail } from "../../testing/asserts";
import { deferred, delay } from "../../async/mod";

Deno.test("Finished appends to Readable correctly", async () => {
  const rs = new Readable({
    read() {},
  });

  const [finishedExecution, finishedCb] = mustCall((err) => {
    assert(!err);
  });

  finished(rs, finishedCb);

  rs.push(null);
  rs.resume();

  await finishedExecution;
});

Deno.test("Finished appends to Writable correctly", async () => {
  const ws = new Writable({
    write(_data, _enc, cb) {
      cb();
    },
  });

  const [finishedExecution, finishedCb] = mustCall((err) => {
    assert(!err);
  });

  finished(ws, finishedCb);

  ws.end();

  await finishedExecution;
});

Deno.test("Finished appends to Transform correctly", async () => {
  const tr = new Transform({
    transform(_data, _enc, cb) {
      cb();
    },
  });

  let finish = false;
  let ended = false;

  tr.on("end", () => {
    ended = true;
  });

  tr.on("finish", () => {
    finish = true;
  });

  const [finishedExecution, finishedCb] = mustCall((err) => {
    assert(!err);
    assert(finish);
    assert(ended);
  });

  finished(tr, finishedCb);

  tr.end();
  tr.resume();

  await finishedExecution;
});

Deno.test("The function returned by Finished clears the listeners", async () => {
  const finishedExecution = deferred();

  const ws = new Writable({
    write(_data, _env, cb) {
      cb();
    },
  });

  const removeListener = finished(ws, () => {
    finishedExecution.reject();
  });
  removeListener();
  ws.end();

  await Promise.race([
    delay(100),
    finishedExecution,
  ])
    .catch(() => fail("Finished was executed"));
});
