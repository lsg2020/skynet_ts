// Copyright 2010 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// Ported from
// https://github.com/golang/go/blob/master/src/net/http/responsewrite_test.go

import { TextProtoReader } from "../textproto/mod";
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
  assertThrowsAsync,
} from "../testing/asserts";
import {
  _parseAddrFromStr,
  Response,
  serve,
  Server,
  ServerRequest,
  serveTLS,
} from "./server";
import { BufReader, BufWriter } from "../io/bufio";
import { delay } from "../async/delay";
import { mockConn } from "./_mock_conn";
import { dirname, fromFileUrl, join, resolve } from "../path/mod";
import { Buffer } from "../io/buffer";
import { readAll, writeAll } from "../io/util";

const moduleDir = dirname(fromFileUrl(import.meta.url));
const testdataDir = resolve(moduleDir, "testdata");

interface ResponseTest {
  response: Response;
  raw: string;
}

const responseTests: ResponseTest[] = [
  // Default response
  {
    response: {},
    raw: "HTTP/1.1 200 OK\r\n" + "content-length: 0" + "\r\n\r\n",
  },
  // Empty body with status
  {
    response: {
      status: 404,
    },
    raw: "HTTP/1.1 404 Not Found\r\n" + "content-length: 0" + "\r\n\r\n",
  },
  {
    response: {
      status: 893,
      statusText: "Custom error",
    },
    raw: "HTTP/1.1 893 Custom error\r\n" + "content-length: 0" + "\r\n\r\n",
  },
  {
    response: {
      status: 893,
      statusText: "",
    },
    raw: "HTTP/1.1 893 \r\n" + "content-length: 0" + "\r\n\r\n",
  },
  // HTTP/1.1, chunked coding; empty trailer; close
  {
    response: {
      status: 200,
      body: new Buffer(new TextEncoder().encode("abcdef")),
    },

    raw: "HTTP/1.1 200 OK\r\n" +
      "transfer-encoding: chunked\r\n\r\n" +
      "6\r\nabcdef\r\n0\r\n\r\n",
  },
];

Deno.test("responseWrite", async function () {
  for (const testCase of responseTests) {
    const buf = new Buffer();
    const bufw = new BufWriter(buf);
    const request = new ServerRequest();
    request.w = bufw;

    request.conn = mockConn();

    await request.respond(testCase.response);
    assertEquals(new TextDecoder().decode(buf.bytes()), testCase.raw);
    await request.done;
  }
});

Deno.test("requestContentLength", function (): void {
  // Has content length
  {
    const req = new ServerRequest();
    req.headers = new Headers();
    req.headers.set("content-length", "5");
    const buf = new Buffer(new TextEncoder().encode("Hello"));
    req.r = new BufReader(buf);
    assertEquals(req.contentLength, 5);
  }
  // No content length
  {
    const shortText = "Hello";
    const req = new ServerRequest();
    req.headers = new Headers();
    req.headers.set("transfer-encoding", "chunked");
    let chunksData = "";
    let chunkOffset = 0;
    const maxChunkSize = 70;
    while (chunkOffset < shortText.length) {
      const chunkSize = Math.min(maxChunkSize, shortText.length - chunkOffset);
      chunksData += `${chunkSize.toString(16)}\r\n${
        shortText.substr(chunkOffset, chunkSize)
      }\r\n`;
      chunkOffset += chunkSize;
    }
    chunksData += "0\r\n\r\n";
    const buf = new Buffer(new TextEncoder().encode(chunksData));
    req.r = new BufReader(buf);
    assertEquals(req.contentLength, null);
  }
});

interface TotalReader extends Deno.Reader {
  total: number;
}
function totalReader(r: Deno.Reader): TotalReader {
  let _total = 0;
  async function read(p: Uint8Array): Promise<number | null> {
    const result = await r.read(p);
    if (typeof result === "number") {
      _total += result;
    }
    return result;
  }
  return {
    read,
    get total(): number {
      return _total;
    },
  };
}
Deno.test("requestBodyWithContentLength", async function () {
  {
    const req = new ServerRequest();
    req.headers = new Headers();
    req.headers.set("content-length", "5");
    const buf = new Buffer(new TextEncoder().encode("Hello"));
    req.r = new BufReader(buf);
    const body = new TextDecoder().decode(await readAll(req.body));
    assertEquals(body, "Hello");
  }

  // Larger than internal buf
  {
    const longText = "1234\n".repeat(1000);
    const req = new ServerRequest();
    req.headers = new Headers();
    req.headers.set("Content-Length", "5000");
    const buf = new Buffer(new TextEncoder().encode(longText));
    req.r = new BufReader(buf);
    const body = new TextDecoder().decode(await readAll(req.body));
    assertEquals(body, longText);
  }
  // Handler ignored to consume body
});
Deno.test(
  "ServerRequest.finalize() should consume unread body / content-length",
  async () => {
    const text = "deno.land";
    const req = new ServerRequest();
    req.headers = new Headers();
    req.headers.set("content-length", "" + text.length);
    const tr = totalReader(new Buffer(new TextEncoder().encode(text)));
    req.r = new BufReader(tr);
    req.w = new BufWriter(new Buffer());
    await req.respond({ status: 200, body: "ok" });
    assertEquals(tr.total, 0);
    await req.finalize();
    assertEquals(tr.total, text.length);
  },
);
Deno.test(
  "ServerRequest.finalize() should consume unread body / chunked, trailers",
  async () => {
    const text = [
      "5",
      "Hello",
      "4",
      "Deno",
      "0",
      "",
      "deno: land",
      "node: js",
      "",
      "",
    ].join("\r\n");
    const req = new ServerRequest();
    req.headers = new Headers();
    req.headers.set("transfer-encoding", "chunked");
    req.headers.set("trailer", "deno,node");
    const body = new TextEncoder().encode(text);
    const tr = totalReader(new Buffer(body));
    req.r = new BufReader(tr);
    req.w = new BufWriter(new Buffer());
    await req.respond({ status: 200, body: "ok" });
    assertEquals(tr.total, 0);
    assertEquals(req.headers.has("trailer"), true);
    assertEquals(req.headers.has("deno"), false);
    assertEquals(req.headers.has("node"), false);
    await req.finalize();
    assertEquals(tr.total, body.byteLength);
    assertEquals(req.headers.has("trailer"), false);
    assertEquals(req.headers.get("deno"), "land");
    assertEquals(req.headers.get("node"), "js");
  },
);
Deno.test("requestBodyWithTransferEncoding", async function () {
  {
    const shortText = "Hello";
    const req = new ServerRequest();
    req.headers = new Headers();
    req.headers.set("transfer-encoding", "chunked");
    let chunksData = "";
    let chunkOffset = 0;
    const maxChunkSize = 70;
    while (chunkOffset < shortText.length) {
      const chunkSize = Math.min(maxChunkSize, shortText.length - chunkOffset);
      chunksData += `${chunkSize.toString(16)}\r\n${
        shortText.substr(chunkOffset, chunkSize)
      }\r\n`;
      chunkOffset += chunkSize;
    }
    chunksData += "0\r\n\r\n";
    const buf = new Buffer(new TextEncoder().encode(chunksData));
    req.r = new BufReader(buf);
    const body = new TextDecoder().decode(await readAll(req.body));
    assertEquals(body, shortText);
  }

  // Larger than internal buf
  {
    const longText = "1234\n".repeat(1000);
    const req = new ServerRequest();
    req.headers = new Headers();
    req.headers.set("transfer-encoding", "chunked");
    let chunksData = "";
    let chunkOffset = 0;
    const maxChunkSize = 70;
    while (chunkOffset < longText.length) {
      const chunkSize = Math.min(maxChunkSize, longText.length - chunkOffset);
      chunksData += `${chunkSize.toString(16)}\r\n${
        longText.substr(chunkOffset, chunkSize)
      }\r\n`;
      chunkOffset += chunkSize;
    }
    chunksData += "0\r\n\r\n";
    const buf = new Buffer(new TextEncoder().encode(chunksData));
    req.r = new BufReader(buf);
    const body = new TextDecoder().decode(await readAll(req.body));
    assertEquals(body, longText);
  }
});

Deno.test("requestBodyReaderWithContentLength", async function (): Promise<
  void
> {
  {
    const shortText = "Hello";
    const req = new ServerRequest();
    req.headers = new Headers();
    req.headers.set("content-length", "" + shortText.length);
    const buf = new Buffer(new TextEncoder().encode(shortText));
    req.r = new BufReader(buf);
    const readBuf = new Uint8Array(6);
    let offset = 0;
    while (offset < shortText.length) {
      const nread = await req.body.read(readBuf);
      assert(nread !== null);
      const s = new TextDecoder().decode(readBuf.subarray(0, nread as number));
      assertEquals(shortText.substr(offset, nread as number), s);
      offset += nread as number;
    }
    const nread = await req.body.read(readBuf);
    assertEquals(nread, null);
  }

  // Larger than given buf
  {
    const longText = "1234\n".repeat(1000);
    const req = new ServerRequest();
    req.headers = new Headers();
    req.headers.set("Content-Length", "5000");
    const buf = new Buffer(new TextEncoder().encode(longText));
    req.r = new BufReader(buf);
    const readBuf = new Uint8Array(1000);
    let offset = 0;
    while (offset < longText.length) {
      const nread = await req.body.read(readBuf);
      assert(nread !== null);
      const s = new TextDecoder().decode(readBuf.subarray(0, nread as number));
      assertEquals(longText.substr(offset, nread as number), s);
      offset += nread as number;
    }
    const nread = await req.body.read(readBuf);
    assertEquals(nread, null);
  }
});

Deno.test("requestBodyReaderWithTransferEncoding", async function (): Promise<
  void
> {
  {
    const shortText = "Hello";
    const req = new ServerRequest();
    req.headers = new Headers();
    req.headers.set("transfer-encoding", "chunked");
    let chunksData = "";
    let chunkOffset = 0;
    const maxChunkSize = 70;
    while (chunkOffset < shortText.length) {
      const chunkSize = Math.min(maxChunkSize, shortText.length - chunkOffset);
      chunksData += `${chunkSize.toString(16)}\r\n${
        shortText.substr(chunkOffset, chunkSize)
      }\r\n`;
      chunkOffset += chunkSize;
    }
    chunksData += "0\r\n\r\n";
    const buf = new Buffer(new TextEncoder().encode(chunksData));
    req.r = new BufReader(buf);
    const readBuf = new Uint8Array(6);
    let offset = 0;
    while (offset < shortText.length) {
      const nread = await req.body.read(readBuf);
      assert(nread !== null);
      const s = new TextDecoder().decode(readBuf.subarray(0, nread as number));
      assertEquals(shortText.substr(offset, nread as number), s);
      offset += nread as number;
    }
    const nread = await req.body.read(readBuf);
    assertEquals(nread, null);
  }

  // Larger than internal buf
  {
    const longText = "1234\n".repeat(1000);
    const req = new ServerRequest();
    req.headers = new Headers();
    req.headers.set("transfer-encoding", "chunked");
    let chunksData = "";
    let chunkOffset = 0;
    const maxChunkSize = 70;
    while (chunkOffset < longText.length) {
      const chunkSize = Math.min(maxChunkSize, longText.length - chunkOffset);
      chunksData += `${chunkSize.toString(16)}\r\n${
        longText.substr(chunkOffset, chunkSize)
      }\r\n`;
      chunkOffset += chunkSize;
    }
    chunksData += "0\r\n\r\n";
    const buf = new Buffer(new TextEncoder().encode(chunksData));
    req.r = new BufReader(buf);
    const readBuf = new Uint8Array(1000);
    let offset = 0;
    while (offset < longText.length) {
      const nread = await req.body.read(readBuf);
      assert(nread !== null);
      const s = new TextDecoder().decode(readBuf.subarray(0, nread as number));
      assertEquals(longText.substr(offset, nread as number), s);
      offset += nread as number;
    }
    const nread = await req.body.read(readBuf);
    assertEquals(nread, null);
  }
});

Deno.test({
  name: "destroyed connection",
  fn: async () => {
    // Runs a simple server as another process
    const p = Deno.run({
      cmd: [
        Deno.execPath(),
        "run",
        "--quiet",
        "--allow-net",
        "testdata/simple_server.ts",
      ],
      cwd: moduleDir,
      stdout: "piped",
    });

    let serverIsRunning = true;
    const statusPromise = p
      .status()
      .then((): void => {
        serverIsRunning = false;
      })
      .catch((_): void => {}); // Ignores the error when closing the process.

    try {
      const r = new TextProtoReader(new BufReader(p.stdout));
      const s = await r.readLine();
      assert(s !== null && s.includes("server listening"));
      await delay(100);
      // Reqeusts to the server and immediately closes the connection
      const conn = await Deno.connect({ port: 4502 });
      await conn.write(new TextEncoder().encode("GET / HTTP/1.0\n\n"));
      conn.close();
      // Waits for the server to handle the above (broken) request
      await delay(100);
      assert(serverIsRunning);
    } finally {
      // Stops the sever and allows `p.status()` promise to resolve
      Deno.kill(p.pid, Deno.Signal.SIGKILL);
      await statusPromise;
      p.stdout.close();
      p.close();
    }
  },
});

Deno.test({
  name: "serveTLS",
  fn: async () => {
    // Runs a simple server as another process
    const p = Deno.run({
      cmd: [
        Deno.execPath(),
        "run",
        "--quiet",
        "--allow-net",
        "--allow-read",
        "testdata/simple_https_server.ts",
      ],
      cwd: moduleDir,
      stdout: "piped",
    });

    let serverIsRunning = true;
    const statusPromise = p
      .status()
      .then((): void => {
        serverIsRunning = false;
      })
      .catch((_): void => {}); // Ignores the error when closing the process.

    try {
      const r = new TextProtoReader(new BufReader(p.stdout));
      const s = await r.readLine();
      assert(
        s !== null && s.includes("server listening"),
        "server must be started",
      );
      // Requests to the server and immediately closes the connection
      const conn = await Deno.connectTls({
        hostname: "localhost",
        port: 4503,
        certFile: join(testdataDir, "tls/RootCA.pem"),
      });
      await writeAll(
        conn,
        new TextEncoder().encode("GET / HTTP/1.0\r\n\r\n"),
      );
      const res = new Uint8Array(100);
      const nread = await conn.read(res);
      assert(nread !== null);
      conn.close();
      const resStr = new TextDecoder().decode(res.subarray(0, nread));
      assert(resStr.includes("Hello HTTPS"));
      assert(serverIsRunning);
    } finally {
      // Stops the sever and allows `p.status()` promise to resolve
      Deno.kill(p.pid, Deno.Signal.SIGKILL);
      await statusPromise;
      p.stdout.close();
      p.close();
    }
  },
});

Deno.test(
  "close server while iterating",
  async () => {
    const server = serve(":8123");
    const nextWhileClosing = server[Symbol.asyncIterator]().next();
    server.close();
    assertEquals(await nextWhileClosing, { value: undefined, done: true });

    const nextAfterClosing = server[Symbol.asyncIterator]().next();
    assertEquals(await nextAfterClosing, { value: undefined, done: true });
  },
);

Deno.test({
  name: "[http] close server while connection is open",
  async fn() {
    async function iteratorReq(server: Server) {
      for await (const req of server) {
        await req.respond({ body: new TextEncoder().encode(req.url) });
      }
    }

    const server = serve(":8123");
    const p = iteratorReq(server);
    const conn = await Deno.connect({ hostname: "127.0.0.1", port: 8123 });
    await writeAll(
      conn,
      new TextEncoder().encode("GET /hello HTTP/1.1\r\n\r\n"),
    );
    const res = new Uint8Array(100);
    const nread = await conn.read(res);
    assert(nread !== null);
    const resStr = new TextDecoder().decode(res.subarray(0, nread));
    assertStringIncludes(resStr, "/hello");
    server.close();
    await p;
    // Client connection should still be open, verify that
    // it's visible in resource table.
    const resources = Deno.resources();
    assertEquals(resources[conn.rid], "tcpStream");
    conn.close();
  },
});

Deno.test({
  name: "respond error closes connection",
  async fn() {
    const serverRoutine = async () => {
      const server = serve(":8124");
      for await (const req of server) {
        await assertThrowsAsync(
          async () => {
            await req.respond({
              status: 12345,
              body: new TextEncoder().encode("Hello World"),
            });
          },
          Deno.errors.InvalidData,
          "Empty statusText",
        );
        // The connection should be destroyed
        assert(!(req.conn.rid in Deno.resources()));
        server.close();
      }
    };
    const p = serverRoutine();
    const conn = await Deno.connect({
      hostname: "127.0.0.1",
      port: 8124,
    });
    await writeAll(
      conn,
      new TextEncoder().encode("GET / HTTP/1.1\r\n\r\n"),
    );
    conn.close();
    await p;
  },
});

Deno.test({
  name: "[http] request error gets 400 response",
  async fn() {
    const server = serve(":8124");
    const entry = server[Symbol.asyncIterator]().next();
    const conn = await Deno.connect({
      hostname: "127.0.0.1",
      port: 8124,
    });
    await writeAll(
      conn,
      new TextEncoder().encode(
        "GET / HTTP/1.1\r\nmalformedHeader\r\n\r\n\r\n\r\n",
      ),
    );
    const responseString = new TextDecoder().decode(await readAll(conn));
    assertMatch(
      responseString,
      /^HTTP\/1\.1 400 Bad Request\r\ncontent-length: \d+\r\n\r\n.*\r\n\r\n$/ms,
    );
    conn.close();
    server.close();
    assert((await entry).done);
  },
});

Deno.test({
  name: "[http] finalizing invalid chunked data closes connection",
  async fn() {
    const serverRoutine = async () => {
      const server = serve(":8124");
      for await (const req of server) {
        await req.respond({ status: 200, body: "Hello, world!" });
        break;
      }
      server.close();
    };
    const p = serverRoutine();
    const conn = await Deno.connect({
      hostname: "127.0.0.1",
      port: 8124,
    });
    await writeAll(
      conn,
      new TextEncoder().encode(
        "PUT / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\nzzzzzzz\r\nhello",
      ),
    );
    await conn.closeWrite();
    const responseString = new TextDecoder().decode(await readAll(conn));
    assertEquals(
      responseString,
      "HTTP/1.1 200 OK\r\ncontent-length: 13\r\n\r\nHello, world!",
    );
    conn.close();
    await p;
  },
});

Deno.test({
  name: "[http] finalizing chunked unexpected EOF closes connection",
  async fn() {
    const serverRoutine = async () => {
      const server = serve(":8124");
      for await (const req of server) {
        await req.respond({ status: 200, body: "Hello, world!" });
        break;
      }
      server.close();
    };
    const p = serverRoutine();
    const conn = await Deno.connect({
      hostname: "127.0.0.1",
      port: 8124,
    });
    await writeAll(
      conn,
      new TextEncoder().encode(
        "PUT / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nHello",
      ),
    );
    conn.closeWrite();
    const responseString = new TextDecoder().decode(await readAll(conn));
    assertEquals(
      responseString,
      "HTTP/1.1 200 OK\r\ncontent-length: 13\r\n\r\nHello, world!",
    );
    conn.close();
    await p;
  },
});

Deno.test({
  name:
    "[http] receiving bad request from a closed connection should not throw",
  async fn() {
    const server = serve(":8124");
    const serverRoutine = async () => {
      for await (const req of server) {
        await req.respond({ status: 200, body: "Hello, world!" });
      }
    };
    const p = serverRoutine();
    const conn = await Deno.connect({
      hostname: "127.0.0.1",
      port: 8124,
    });
    await writeAll(
      conn,
      new TextEncoder().encode([
        // A normal request is required:
        "GET / HTTP/1.1",
        "Host: localhost",
        "",
        // The bad request:
        "GET / HTTP/1.1",
        "Host: localhost",
        "INVALID!HEADER!",
        "",
        "",
      ].join("\r\n")),
    );
    // After sending the two requests, don't receive the reponses.

    // Closing the connection now.
    conn.close();

    // The server will write responses to the closed connection,
    // the first few `write()` calls will not throws, until the server received
    // the TCP RST. So we need the normal request before the bad request to
    // make the server do a few writes before it writes that `400` response.

    // Wait for server to handle requests.
    await delay(10);

    server.close();
    await p;
  },
});

Deno.test({
  name: "serveTLS Invalid Cert",
  fn: async () => {
    async function iteratorReq(server: Server) {
      for await (const req of server) {
        await req.respond({ body: new TextEncoder().encode("Hello HTTPS") });
      }
    }
    const port = 9122;
    const tlsOptions = {
      hostname: "localhost",
      port,
      certFile: join(testdataDir, "tls/localhost.crt"),
      keyFile: join(testdataDir, "tls/localhost.key"),
    };
    const server = serveTLS(tlsOptions);
    const p = iteratorReq(server);

    try {
      // Invalid certificate, connection should throw on first read or write
      // but should not crash the server
      const badConn = await Deno.connectTls({
        hostname: "localhost",
        port,
        // certFile
      });
      await assertThrowsAsync(
        () => badConn.read(new Uint8Array(1)),
        Deno.errors.InvalidData,
      );
      badConn.close();

      // Valid request after invalid
      const conn = await Deno.connectTls({
        hostname: "localhost",
        port,
        certFile: join(testdataDir, "tls/RootCA.pem"),
      });

      await writeAll(
        conn,
        new TextEncoder().encode("GET / HTTP/1.0\r\n\r\n"),
      );
      const res = new Uint8Array(100);
      const nread = await conn.read(res);
      assert(nread !== null);
      conn.close();
      const resStr = new TextDecoder().decode(res.subarray(0, nread));
      assert(resStr.includes("Hello HTTPS"));
    } finally {
      // Stops the sever and allows `p.status()` promise to resolve
      server.close();
      await p;
    }
  },
});

Deno.test({
  name: "server.serve() should be able to parse IPV4 address",
  fn: (): void => {
    const server = serve("127.0.0.1:8124");
    const expected = {
      hostname: "127.0.0.1",
      port: 8124,
      transport: "tcp",
    };
    assertEquals(server.listener.addr, expected);
    server.close();
  },
});

Deno.test({
  name: "server._parseAddrFromStr() should be able to parse IPV6 address",
  fn: (): void => {
    const addr = _parseAddrFromStr("[::1]:8124");
    const expected = {
      hostname: "[::1]",
      port: 8124,
    };
    assertEquals(addr, expected);
  },
});

Deno.test({
  name: "server.serve() should be able to parse IPV6 address",
  fn: (): void => {
    const server = serve("[::1]:8124");
    const expected = {
      hostname: "::1",
      port: 8124,
      transport: "tcp",
    };
    assertEquals(server.listener.addr, expected);
    server.close();
  },
});

Deno.test({
  name: "server._parseAddrFromStr() port 80",
  fn: (): void => {
    const addr = _parseAddrFromStr(":80");
    assertEquals(addr.port, 80);
    assertEquals(addr.hostname, "0.0.0.0");
  },
});
