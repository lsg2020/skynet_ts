import * as skynet from "skynet";
import * as http_server from "std/http/server";
import { assert } from "std/testing/asserts";
import * as router from "x/router/mod";
import * as ws from "std/ws/mod";

let [_, listen_ip, listen_port] = JS_INIT_ARGS.split(" ");
let listen_addr = `${listen_ip}:${listen_port}`;
let PTYPE_INSPECTOR = 101;

type ServiceInfo = {
    addr: number,
    name: string,
    listen_addr: string,
    sessions: Map<number, ws.WebSocket>,
    devtools: string,
    proxy?: ws.WebSocket,
};
let services: Map<number, ServiceInfo> = new Map();
async function command_enable(context: skynet.CONTEXT, addr: number, name: string) {
    console.log(`v8_inspector enable:${addr}`);
    if (services.get(addr)) {
        skynet.retpack(context, skynet.self(), PTYPE_INSPECTOR, `ws://${listen_ip}/pause/${addr}`, `ws://${listen_ip}/resume/${addr}`);
        return;
    }
    services.set(addr, {
        addr: addr,
        name: name,
        listen_addr: listen_addr,
        sessions: new Map(),
        devtools: `devtools://devtools/bundled/inspector.html?v8only=true&ws=${listen_addr}/ws/${addr}`,
    });
    skynet.retpack(context, skynet.self(), PTYPE_INSPECTOR, `ws://${listen_ip}/pause/${addr}`, `ws://${listen_ip}/resume/${addr}`);
    (async () => {
        await skynet.call(addr, "debug", "LINK");
        command_disable(context, addr);
    })();
}
;
async function command_disable(context: skynet.CONTEXT, addr: number) {
    console.log(`v8_inspector disable: ${addr}`);
    let service = services.get(addr);
    if (!service) {
        return;
    }
    services.delete(addr);
    if (service.proxy) {
        await service.proxy.close();
    }
    service.sessions.forEach((ws, session_id) => {
        skynet.send(addr, "debug", "v8inspector", "disconnect", session_id);
        ws.close();
    });
}
skynet.register_protocol({
    name: "v8inspector",
    id: PTYPE_INSPECTOR,
    unpack: skynet.string_unpack,
    dispatch: (context: skynet.CONTEXT, msg: string) => {
        let space_index = msg.indexOf("{");
        let session_id = Number(msg.slice(0, space_index - 1));
        msg = msg.slice(space_index);
        let service = services.get(session_id);
        if (!service)
            return;
        let ws = service.sessions.get(session_id);
        if (!ws)
            return;
        ws.send(msg);
    }
});
let http_router = new router.Node();
http_router.add("/", (req: http_server.ServerRequest, params: Map<string, string>) => {
    let template = `
    <!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>skynet_ts inspect</title>
</head>
<body>
  <div id="content"></div>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script>
    document.getElementById('content').innerHTML =
      marked(\`_CONTENT_\`);
  </script>
</body>
</html>
    `;
    let contents = ["# skynet_ts v8 inspector"];
    services.forEach((s) => {
        contents.push(`## [${s.name}:${s.addr}](${s.devtools})\n* ${s.listen_addr}\n* ${s.devtools}\n`);
    });
    req.respond({
        body: template.replace("_CONTENT_", contents.join("\n")),
    });
});
http_router.add("/pause/:addr", async (req: http_server.ServerRequest, params: Map<string, string>) => {
    let addr = Number(params.get("addr"));
    let service = services.get(addr);
    if (!service) {
        req.respond({
            body: `service ${addr} disable v8inspect`,
        });
        return;
    }
    ws.acceptWebSocket({
        conn: req.conn,
        bufReader: req.r,
        bufWriter: req.w,
        headers: req.headers,
    }).then(async (sock) => {
        console.log(`pause connect`, sock.conn.rid);
        service!.proxy = sock;
        if (service!.sessions.size == 0 && service!.proxy) {
            service!.proxy.send("quit");
            service!.proxy.close();
            service!.proxy = undefined;
        }
        for await (const event of sock) {
            if (ws.isWebSocketCloseEvent(event)) {
                console.log(`pause close`, sock.conn.rid);
                service!.proxy = undefined;
                break;
            }
            else if (typeof event == "string" || event instanceof Uint8Array) {
                console.log("pause message", sock.conn.rid, event);
            }
        }
    });
});
http_router.add("/resume/:addr", async (req: http_server.ServerRequest, params: Map<string, string>) => {
    let addr = Number(params.get("addr"));
    console.log(`resume`, addr);
    let service = services.get(addr);
    assert(service);
    let proxy = service.proxy;
    service.proxy = undefined;
    if (proxy) {
        proxy.send("quit");
        proxy.close();
    }
    req.respond({ body: "ok" });
});
http_router.add("/ws/:addr", async (req: http_server.ServerRequest, params: Map<string, string>) => {
    let addr = Number(params.get("addr"));
    let service = services.get(addr);
    assert(service);
    let close_ws = (rid: number) => {
        let session_id = 0;
        service!.sessions.forEach((ws, s_id) => {
            if (ws.conn.rid == rid) {
                session_id = s_id;
            }
        });
        if (!session_id)
            return;
        skynet.send(service!.addr, "debug", "v8inspector", "disconnect", session_id);
        service!.sessions.delete(session_id);
        if (service!.sessions.size == 0 && service!.proxy) {
            service!.proxy.send("quit");
            service!.proxy.close();
            service!.proxy = undefined;
        }
    };
    ws.acceptWebSocket({
        conn: req.conn,
        bufReader: req.r,
        bufWriter: req.w,
        headers: req.headers,
    }).then(async (sock) => {
        console.log(`connect`, sock.conn.rid);
        let [sid] = await skynet.call(service!.addr, "debug", "v8inspector", "connect", sock.conn.rid);
        let session_id = sid;
        service!.sessions.set(session_id, sock);
        for await (const event of sock) {
            if (ws.isWebSocketCloseEvent(event)) {
                console.log(`close`, sock.conn.rid);
                close_ws(sock.conn.rid);
                break;
            }
            else if (typeof event == "string") {
                if (service!.proxy) {
                    service!.proxy.send(session_id + event);
                }
                else {
                    skynet.send(service!.addr, "debug", "v8inspector", "msg", session_id, event);
                }
            }
        }
    });
});
http_router.add("/json", async (req: http_server.ServerRequest, params: Map<string, string>) => {
    let response: string[] = [];
    services.forEach((service, addr) => {
        let debug_template: any = {
            ["_DEBUG_ID_"]: `${addr}`,
            ["_DEBUG_NAME_"]: `:${addr}`,
            ["_DEBUG_ADDR_"]: `${listen_addr}/ws/${addr}`,
            ["_DEBUG_DEVTOOLS_"]: `${service.devtools}`,
        };
        let template = `
        {
            "type": "node",
            "id": "_DEBUG_ID_",
            "title": "_DEBUG_NAME_ debug tools for V8",
            "devtoolsFrontendUrl": "_DEBUG_DEVTOOLS_",
            "devtoolsFrontendUrlCompat": "_DEBUG_DEVTOOLS_",
            "webSocketDebuggerUrl": "ws://_DEBUG_ADDR_"
        }
        `;
        for (let k in debug_template) {
            template = template.replaceAll(k, debug_template[k]);
        }
        response.push(template);
    });
    req.respond({
        body: "[" + response.join(",") + "]",
    });
});
http_router.add("/json/version", async (req: http_server.ServerRequest, params: Map<string, string>) => {
    req.respond({
        body: `
        {
            "Browser": "skynet_ts/0.1.0",
            "Protocol-Version": "1.3"
        }
        `
    });
});
skynet.start(async () => {
    (async () => {
        for await (const req of http_server.serve({ hostname: listen_ip, port: Number(listen_port) })) {
            const [func, params] = http_router.find(req.url);
            if (func) {
                func(req, params);
            }
            else {
                req.respond({
                    body: `url:${req.url} not found`,
                });
            }
        }
    })();
    skynet.dispatch("lua", async (context: skynet.CONTEXT, cmd: string, ...params: any) => {
        if (cmd == "enable") {
            command_enable(context, params[0], params[1]);
        }
        else if (cmd == "disable") {
            command_disable(context, params[0]);
        }
        else {
            assert(false, `v8_inspector unknown cmd: ${cmd}`);
        }
    });
    skynet.register(".v8_inspector");
    console.log(`v8_inspector listen on ${listen_port}`);
});
