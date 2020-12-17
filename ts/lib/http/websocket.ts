import * as skynet from "skynet"
import * as socket from "skynet/socket"
import * as crypt from "crypt"
import * as internal from "http/internal"
import * as httpd from "http/httpd"
import * as http_helper from "http/helper"
import { HEADER_MAP, SOCKET_INTERFACE } from "./types"

import {
    decode_str,
    decode_uint16_be,
    decode_uint32_be,
    decode_uint8_be,
    encode_uint16_be,
    encode_uint8_be,
    encode_uint32_be,
    encode_uint64_be,
    decode_uint_be,
} from "pack"


let GLOBAL_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
let MAX_FRAME_SIZE = 256 * 1024; // max frame is 256K
const BUFFER_INIT_SIZE = 512;

export enum HANDLE_TYPE {
    MESSAGE,
    CONNECT,
    CLOSE,
    HANDSHAKE,
    PING,
    PONG,
    ERROR,
    WARNING,
}
export interface HANDLE {
    [HANDLE_TYPE.MESSAGE]?: (socket_id: number, msg: Uint8Array, sz: number) => void,
    [HANDLE_TYPE.CONNECT]?: (socket_id: number) => void,
    [HANDLE_TYPE.CLOSE]?: (socket_id: number, code?: number, reason?: string) => void,
    [HANDLE_TYPE.HANDSHAKE]?: (socket_id: number, handler: HEADER_MAP, url: string) => void,
    [HANDLE_TYPE.PING]?: (socket_id: number) => void,
    [HANDLE_TYPE.PONG]?: (socket_id: number) => void,
    [HANDLE_TYPE.ERROR]?: (socket_id: number) => void,
    [HANDLE_TYPE.WARNING]?: (ws: WS_OBJ, sz: number) => void,
}

export type ACCEPT_OPTIONS = {
    socket_id: number,
    addr: string,
    protocol: string,
    upgrade?: {
        header: HEADER_MAP,
        method: string,
        url: string,
    },
    handle?: HANDLE,
}

export enum OP_CODE {
    FRAME = 0x00,
    TEXT = 0x01,
    BINARY = 0x02,
    CLOSE = 0x08,
    PING = 0x09,
    PONG = 0x0A,
}

enum WS_MODULE {
    CLIENT = "client",
    SERVER = "server",
}

type WS_OBJ = {
    close: () => void,
    socket_id: number,
    mode: WS_MODULE,
    addr?: string,
    is_close?: boolean,
    socket: SOCKET_INTERFACE,
    handle?: HANDLE,
    recv_buffer?: Uint8Array,
}

let ws_pool = new Map<number, WS_OBJ>();

function _close_websocket(ws_obj: WS_OBJ) {
    let id = ws_obj.socket_id;
    skynet.assert(ws_pool.get(id) == ws_obj);
    ws_obj.is_close = true;
    ws_pool.delete(id);
    ws_obj.close();
}

async function _write_handshake(ws: WS_OBJ, host: string, url: string, header?: HEADER_MAP) {
    let key = crypt.base64encode(new Uint8Array([...crypt.randomkey(), ...crypt.randomkey()]));
    let request_header: HEADER_MAP = new Map([
        ["Upgrade", "websocket"],
        ["Connection", "Upgrade"],
        ["Sec-WebSocket-Version", "13"],
        ["Sec-WebSocket-Key", key],
    ])

    header && header.forEach((v, k) => request_header.set(k, v));

    let [code, body, recv_header] = await internal.request(ws.socket, {
        method: "GET",
        host,
        url,
        header: request_header,
    })
    if (code != 101) {
        throw new Error(`websocket handshake error: code[${code}] info:${body}`);
    }
    if (!recv_header.has("upgrade") || (recv_header.get("upgrade") as string).toLowerCase() != "websocket") {
        throw new Error(`websocket handshake upgrade must websocket`);
    }
    if (!recv_header.has("connection") || (recv_header.get("connection") as string).toLowerCase() != "upgrade") {
        throw new Error(`websocket handshake connection must upgrade`);
    }
    let sw_key = recv_header.get("sec-websocket-accept") as string;
    if (!sw_key) {
        throw new Error(`websocket handshake need Sec-WebSocket-Accept`);
    }

    sw_key = String.fromCharCode.apply(null, Array.from(crypt.base64decode(sw_key)));
    if (sw_key != String.fromCharCode.apply(null, Array.from(crypt.sha1.array(key + GLOBAL_GUID)))) {
        throw new Error(`websocket handshake invalid Sec-WebSocket-Accept`);
    }
}

async function _read_handshake(ws: WS_OBJ, accept_ops?: ACCEPT_OPTIONS): Promise<[number, string?, HEADER_MAP?]> {
    let header, url, method;
    if (accept_ops && accept_ops.upgrade) {
        url = accept_ops.upgrade.url;
        method = accept_ops.upgrade.method;
        header = accept_ops.upgrade.header;
    } else {
        let tmpline = new Array<string>();
        let header_body = await internal.recvheader(ws.socket.read, tmpline, new Uint8Array(), 0);
        if (!header_body) {
            return [443];
        }
        let request = tmpline![0];
        let r = request.match(/^(\w+)\s+(.+)\s+HTTP\/([\d\.]+)/);
        if (!r) {
            return [400];
        }
        let httpver;
        [method, url, httpver] = [r[1], r[2], Number(r[3])];
        if (method != "GET") {
            return [400, "need GET method"];
        }
        if (httpver < 1.1) {
            return [505];
        }
        
        header = internal.parseheader(tmpline!, 1, new Map());
    }

    if (!header) {
        return [400];
    }
    if (!header.has("upgrade") || (header.get("upgrade") as string).toLowerCase() != "websocket") {
        return [426, "Upgrade Required"];
    }
    if (!header.get("host")) {
        return [400, "host Required"];
    }
    if (!header.has("connection") || (header.get("connection") as string).toLowerCase().indexOf("upgrade") < 0) {
        return [400, "Connection must Upgrade"];
    }
    
    let sw_key = header.get("sec-websocket-key") as string;
    if (!sw_key) {
        return [400, "Sec-WebSocket-Key Required"];
    } else {
        let raw_key = crypt.base64decode(sw_key);
        if (raw_key.length != 16) {
            return [400, "Sec-WebSocket-Key invalid"];
        }
    }

    if (header.get("sec-websocket-version") != "13") {
        return [400, "Sec-WebSocket-Version must 13"];
    }
    
    let sw_protocol = header.get("sec-websocket-protocol") as string;
    let sub_pro = "";
    if (sw_protocol) {
        let has_chat = false;
        sw_protocol.split(/[\s,]+/).forEach((sub_protocol) => {
            if (sub_protocol == "chat") {
                sub_pro = "Sec-WebSocket-Protocol: chat\r\n";
                has_chat = true;
            }
        })

        if (!has_chat) {
            return [400, "Sec-WebSocket-Protocol need include chat"];
        }
    }

    // response handshake
    let accept = crypt.base64encode(crypt.sha1.array(sw_key + GLOBAL_GUID));
    let resp = "HTTP/1.1 101 Switching Protocols\r\n" + 
                "Upgrade: websocket\r\n" + 
                "Connection: Upgrade\r\n" +
                `Sec-WebSocket-Accept: ${accept}\r\n` + 
                sub_pro + "\r\n"
    ws.socket.write(resp);
    return [0, url, header];
}

function _try_handle<T extends keyof HANDLE>(ws: WS_OBJ, type: T, ...params: any) {
    if (ws && ws.handle && ws.handle[type]) {
        let handle = ws.handle[type] as any;
        handle(ws.socket_id, ...params);
    }
}

// TODO use send_buffer
function _write_frame(ws: WS_OBJ, op: OP_CODE, payload_data?: Uint8Array, masking_key?: number) {
    payload_data = payload_data || new Uint8Array();
    let payload_len = payload_data.length;
    let v1 = 0x80 | op;
    let mask = masking_key && 0x80 || 0x00;
    
    let s;
    // mask set to 0
    if (payload_len < 126) {
        s = new Uint8Array(2);
        encode_uint8_be(s, 0, v1);
        encode_uint8_be(s, 1, mask | payload_len);
    } else if (payload_len < 0xffff) {
        s = new Uint8Array(4);
        encode_uint8_be(s, 0, v1);
        encode_uint8_be(s, 1, 126);
        encode_uint16_be(s, 2, payload_len);
    } else {
        s = new Uint8Array(10);
        encode_uint8_be(s, 0, v1);
        encode_uint8_be(s, 1, 127);
        encode_uint64_be(s, 2, payload_len);
    }
    let write_bufs = [s];

    // write masking_key
    if (masking_key) {
        s = new Uint8Array(4);
        encode_uint32_be(s, 0, masking_key);
        write_bufs.push(s);
        crypt.xor(payload_data, 0, payload_data.length, s);
    }

    if (payload_len > 0) {
        write_bufs.push(payload_data);
    }
    ws.socket.write(write_bufs);
}

function _read_close(payload_data: Uint8Array, payload_len: number): [number, string] {
    let code = 0;
    let reason = "";
    if (payload_len >= 2) {
        code = decode_uint16_be(payload_data, 0);
        reason = String.fromCharCode.apply(null, Array.from(payload_data.slice(2, payload_len)));
    }
    return [code, reason];
}

async function _read_frame(ws: WS_OBJ, buffer?: Uint8Array, offset: number = 0): Promise<[boolean, OP_CODE, Uint8Array, number]> {
    buffer = buffer || ws.recv_buffer;
    if (!buffer) {
        ws.recv_buffer = new Uint8Array(BUFFER_INIT_SIZE);
        buffer = ws.recv_buffer;
    }
    let [header, header_sz] = await ws.socket.read(2);
    let v1 = decode_uint8_be(header, 0);
    let v2 = decode_uint8_be(header, 1);
    let fin = ((v1 & 0x80) != 0);
    
    let op = v1 & 0x0f;
    let mask = ((v2 & 0x80) != 0);
    let payload_len = (v2 & 0x7f);
    if (payload_len == 126) {
        let [s] = await ws.socket.read(2);
        payload_len = decode_uint16_be(s, 0);
    } else if (payload_len == 127) {
        let [s] = await ws.socket.read(8);
        payload_len = decode_uint_be(s, 0, 8);
    }

    if (ws.mode == WS_MODULE.SERVER && payload_len > MAX_FRAME_SIZE) {
        throw new Error("payload_len is too large");
    }

    let masking_key: Uint8Array|undefined;
    if (mask) {
        [masking_key] = await ws.socket.read(4);
    }
    if (payload_len > 0) {
        let [msg, sz] = await ws.socket.read(payload_len, buffer, offset);
        if (buffer == ws.recv_buffer) {
            ws.recv_buffer = msg;
        }
        buffer = msg;
        offset += sz
    }
    if (masking_key && buffer) {
        crypt.xor(buffer, offset - payload_len, offset, masking_key, 4);
    }

    return [fin, op as OP_CODE, buffer, payload_len];
}

async function _resolve_accept(ws: WS_OBJ, options?: ACCEPT_OPTIONS) {
    _try_handle(ws, HANDLE_TYPE.CONNECT);
    let [code, err, header] = await _read_handshake(ws, options);
    if (code) {
        httpd.write_response(ws.socket.write, code, err!);
        _try_handle(ws, HANDLE_TYPE.CLOSE);
        return;
    }

    let url = err;
    _try_handle(ws, HANDLE_TYPE.HANDSHAKE, [header!, url]);
    let recv_count = 0;
    
    while (true) {
        if (ws.is_close) {
            _try_handle(ws, HANDLE_TYPE.CLOSE);
            return;
        }

        let [fin, op, payload_data, payload_size] = await _read_frame(ws, undefined, recv_count);
        recv_count += payload_size!;
        if (op == OP_CODE.CLOSE) {
            let [code, reason] = await _read_close(payload_data, recv_count);
            _write_frame(ws, OP_CODE.CLOSE);
            _try_handle(ws, HANDLE_TYPE.CLOSE, code, reason);
            break;
        } else if (op == OP_CODE.PING) {
            _write_frame(ws, OP_CODE.PONG, payload_data);
            _try_handle(ws, HANDLE_TYPE.PING);
        } else if (op == OP_CODE.PONG) {
            _try_handle(ws, HANDLE_TYPE.PONG);
        } else {
            if (recv_count > MAX_FRAME_SIZE) {
                throw new Error("payload_len is to large");
            }
            if (fin) {                    
                _try_handle(ws, HANDLE_TYPE.MESSAGE, payload_data, recv_count);
                recv_count = 0;
            }
        }
    }
}

function _new_client_ws(socket_id: number, protocol: string) {
    let obj: WS_OBJ = {
        close: () => {
            socket.close(socket_id);
        },
        socket: {
            websocket: true,
            read: http_helper.readfunc(socket_id),
            write: http_helper.writefunc(socket_id),
            readall: (buffer?: Uint8Array, offset?: number) => {
                return socket.readall(socket_id);
            },    
        },
        mode: WS_MODULE.CLIENT,
        socket_id: socket_id,
    }
    
    ws_pool.set(socket_id, obj);
    return obj;
}

function _new_server_ws(socket_id: number, handle?: HANDLE, protocol?: string) {
    let obj: WS_OBJ = {
        close: () => {
            socket.close(socket_id);
        },
        socket: {
            websocket: true,
            read: http_helper.readfunc(socket_id),
            write: http_helper.writefunc(socket_id),
            readall: (buffer?: Uint8Array, offset?: number) => {
                return socket.readall(socket_id);
            },    
        },
        mode: WS_MODULE.SERVER,
        socket_id: socket_id,
        handle: handle,
    }
    
    ws_pool.set(socket_id, obj);
    return obj;
}

export async function accept(accept_ops: ACCEPT_OPTIONS): Promise<[boolean, string?]> {
    if (!accept_ops.upgrade) {
        await socket.start(accept_ops.socket_id);
    }
    let protocol = accept_ops.protocol || "ws";
    let ws_obj = _new_server_ws(accept_ops.socket_id, accept_ops.handle, protocol);
    ws_obj.addr = accept_ops.addr;
    let on_warning = accept_ops.handle && accept_ops.handle[HANDLE_TYPE.WARNING];
    if (on_warning) {
        socket.warning(accept_ops.socket_id, (id, sz) => {
            on_warning!(ws_obj, sz);
        });
    }

    let ok = true;
    let err: string;
    try {
        await _resolve_accept(ws_obj, accept_ops);
    } catch (e) {
        ok = false;
        err = e.message;
    }
    if (ws_obj.is_close) {
        _close_websocket(ws_obj);
    }
    if (!ok) {
        if (err! == http_helper.SOCKET_ERROR) {
            if (ws_obj.is_close) {
                _try_handle(ws_obj, HANDLE_TYPE.CLOSE);
            } else {
                _try_handle(ws_obj, HANDLE_TYPE.ERROR);
            }
        } else {
            return [false, err!]
        }
    }
    return [true];
}

export async function connect(url: string, header?: HEADER_MAP, timeout?: number) {
    let r = url.match(/^(wss?):\/\/([^\/]+)(.*)$/);
    if (!r) {
        throw new Error(`invalid url: ${url}`);
    }
    let [protocol, host, uri] = [r[1], r[2], r[3]];
    r = host.match(/^([^:]+):?(\d*)$/);
    if (!r) {
        throw new Error(`invalid host: ${host}`);
    }
    let host_name = r[1];
    let host_port = (protocol == "ws" ? 80 : 443);
    if (r[2]) {
        host_port = Number(r[2]);
    }

    uri = url || "/";
    let fd_id = await http_helper.connect(host_name, host_port, timeout);
    let ws_obj = _new_client_ws(fd_id, protocol);
    ws_obj.addr = host
    await _write_handshake(ws_obj, host_name, uri, header);
    return fd_id;
}

export async function read(id: number): Promise<[boolean, Uint8Array, number]> {
    let ws_obj = skynet.assert(ws_pool.get(id))!;
    let recv_count = 0;
    while (true) {
        let [fin, op, payload_data, payload_len] = await _read_frame(ws_obj, undefined, recv_count);
        recv_count += payload_len;
        if (op == OP_CODE.CLOSE) {
            _close_websocket(ws_obj);
            return [false, payload_data, recv_count];
        } else if (op == OP_CODE.PING) {
            _write_frame(ws_obj, OP_CODE.PONG, payload_data);
        } else if (op != OP_CODE.PONG) {
            if (fin) {
                return [true, payload_data, recv_count];
            }
        }
    }
}

export function write(id: number, data: Uint8Array, fmt?: OP_CODE, masking_key?: number) {
    let ws_obj = skynet.assert(ws_pool.get(id))!;
    fmt = fmt || OP_CODE.TEXT;
    skynet.assert(fmt == OP_CODE.TEXT || fmt == OP_CODE.BINARY);
    _write_frame(ws_obj, fmt, data, masking_key);
}

export function ping(id: number) {
    let ws_obj = skynet.assert(ws_pool.get(id))!;
    _write_frame(ws_obj, OP_CODE.PING);
}

export function addrinfo(id: number) {
    let ws_obj = skynet.assert(ws_pool.get(id))!;
    return ws_obj.addr;
}

export function close(id: number, code?: number, reason: string = "") {
    let ws_obj = ws_pool.get(id);
    if (!ws_obj) {
        return;
    }

    try {
        let payload_data;
        if (code) {
            let reason_buf = new TextEncoder().encode(reason);
            payload_data = new Uint8Array(2 + reason_buf.length);
            encode_uint16_be(payload_data, 0, code);
            payload_data.set(reason_buf, 2);
        }
        _write_frame(ws_obj, OP_CODE.CLOSE, payload_data);
    } catch(e) {
        skynet.error(e.message);
    }
    _close_websocket(ws_obj);
}
