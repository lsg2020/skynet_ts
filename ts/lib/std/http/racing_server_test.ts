// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import { assert, assertEquals } from "../testing/asserts";
import { BufReader, BufWriter } from "../io/bufio";
import { TextProtoReader } from "../textproto/mod";
import { dirname, fromFileUrl } from "../path/mod";

const moduleDir = dirname(fromFileUrl(import.meta.url));

let server: Deno.Process<Deno.RunOptions & { stdout: "piped" }>;
async function startServer() {
  server = Deno.run({
    cmd: [Deno.execPath(), "run", "--quiet", "-A", "racing_server.ts"],
    cwd: moduleDir,
    stdout: "piped",
  });
  // Once racing server is ready it will write to its stdout.
  assert(server.stdout != null);
  const r = new TextProtoReader(new BufReader(server.stdout));
  const s = await r.readLine();
  assert(s !== null && s.includes("Racing server listening..."));
}
function killServer(): void {
  server.close();
  server.stdout.close();
}

const input = [
  "GET / HTTP/1.1\r\n\r\n",
  "GET / HTTP/1.1\r\n\r\n",
  "GET / HTTP/1.1\r\n\r\n",
  "POST / HTTP/1.1\r\ncontent-length: 4\r\n\r\ndeno",
  "POST / HTTP/1.1\r\ntransfer-encoding: chunked\r\n\r\n4\r\ndeno\r\n0\r\n\r\n",
  "POST / HTTP/1.1\r\ntransfer-encoding: chunked\r\ntrailer: deno\r\n\r\n4\r\ndeno\r\n0\r\n\r\ndeno: land\r\n\r\n",
  "GET / HTTP/1.1\r\n\r\n",
].join("");
const HUGE_BODY_SIZE = 1024 * 1024;
const output = `HTTP/1.1 200 OK
content-length: 6

Step1
HTTP/1.1 200 OK
content-length: ${HUGE_BODY_SIZE}

${"a".repeat(HUGE_BODY_SIZE)}HTTP/1.1 200 OK
content-length: ${HUGE_BODY_SIZE}

${"b".repeat(HUGE_BODY_SIZE)}HTTP/1.1 200 OK
content-length: 6

Step4
HTTP/1.1 200 OK
content-length: 6

Step5
HTTP/1.1 200 OK
content-length: 6

Step6
HTTP/1.1 200 OK
content-length: 6

Step7
`;

Deno.test("serverPipelineRace", async function () {
  await startServer();

  const conn = await Deno.connect({ port: 4501 });
  const r = new TextProtoReader(new BufReader(conn));
  const w = new BufWriter(conn);
  await w.write(new TextEncoder().encode(input));
  await w.flush();
  const outLines = output.split("\n");
  // length - 1 to disregard last empty line
  for (let i = 0; i < outLines.length - 1; i++) {
    const s = await r.readLine();
    assertEquals(s, outLines[i]);
  }
  killServer();
  conn.close();
});
