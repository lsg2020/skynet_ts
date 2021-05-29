import { READ_FUNC, HEADER_MAP, SOCKET_INTERFACE, REQUEST_OPTIONS } from "http/types"
import * as http_helper from "http/helper"

const LIMIT = 8192;
const SPLIT_STR = new TextEncoder().encode("\r\n");
const END_STR = new TextEncoder().encode("\r\n\r\n");

function buffer_find(buffer: Uint8Array, start: number, end: number, dst: Uint8Array) {
    for (let i=start; i<=end-dst.length; i++) {
        let find = true;
        for (let j=0; j<dst.length; j++) {
            if (buffer[i+j] != dst[j]) {
                find = false;
                break;
            }
        }
        if (find) {
            return i;
        }
    }
    return -1;
}

export async function recvheader(readbytes: READ_FUNC, lines: Array<string>, header: Uint8Array, header_sz: number) {
    if (header_sz >= SPLIT_STR.length) {
        if (buffer_find(header, 0, SPLIT_STR.length, SPLIT_STR) == 0) {
            return header.subarray(SPLIT_STR.length, header_sz);
        }
    }
    let result;
    let e = buffer_find(header, 0, header_sz, END_STR);
    if (e >= 0) {
        result = header.subarray(e + END_STR.length, header_sz);
        header = header.subarray(0, e);
    } else {
        while (true) {
            let [bytes, sz] = await readbytes(undefined, header, header_sz);
            header = bytes;
            header_sz += sz;

            e = buffer_find(header, 0, header_sz, END_STR);
            if (e >= 0) {
                result = header.subarray(e + END_STR.length, header_sz);
                header = header.subarray(0, e);
                break;
            }
            if (buffer_find(header, 0, SPLIT_STR.length, SPLIT_STR) == 0) {
                return header.subarray(SPLIT_STR.length, header_sz);
            }
            if (header.length > LIMIT) {
                return;
            }
        }
    }

    http_helper.decode_str(header, 0, header.length).split("\r\n").forEach((v) => {
        if (v) {
            lines.push(v);
        }
    })
    return result;
}

export function parseheader(lines: Array<string>, from: number, header: HEADER_MAP) {
    let name, value;
    for (let i=from; i<lines.length; i++) {
        let line = lines[i];
        if (line[0] == '\t') {
            if (!name) {
                return;
            }
            header.set(name, (header.get(name) || "") + line.slice(1));
        } else {
            let r = line.match(/^(.+?):\s*(.*)/);
            if (!r) {
                return;
            }

            name = r[1];
            value = r[2];
            name = name.toLowerCase()
            if (header.has(name)) {
                let v = header.get(name);
                if (typeof(v) == "object") {
                    v.push(value);
                } else {
                    header.set(name, [v as string, value]);
                }
            } else {
                header.set(name, value);
            }
        }
    }

    return header
}

async function chunksize(readbytes: READ_FUNC, body: Uint8Array, body_sz: number): Promise<[number, Uint8Array]|undefined> {
    while (true) {
        let index = buffer_find(body, 0, body_sz, SPLIT_STR);
        if (index >= 0) {
            return [parseInt(http_helper.decode_str(body, 0, index), 16), body.subarray(index+SPLIT_STR.length, body_sz)];
        }

        if (body_sz > 128) {
            return;
        }
        let [msg, sz] = await readbytes(undefined, body, body_sz);
        body = msg;
        body_sz += sz;
    }
}

async function readcrln(readbytes: READ_FUNC, body: Uint8Array) {
    if (body.length >= SPLIT_STR.length) {
        if (buffer_find(body, 0, SPLIT_STR.length, SPLIT_STR) == -1) {
            return;
        }
        return body.subarray(SPLIT_STR.length);
    } else {
        [body] = await readbytes(2 - body.length, body, body.length);
        if (buffer_find(body, 0, SPLIT_STR.length, SPLIT_STR) == -1) {
            return;
        }
        return new Uint8Array();
    }
}

function buffer_copy(dst: Uint8Array, offset: number, src: Uint8Array) {
    if (dst.length < offset + src.length) {
        let n = new Uint8Array((offset + src.length) * 2);
        n.set(dst);
        dst = n;
    }
    dst.set(src, offset);
    return dst;
}

export async function recvchunkedbody(readbytes: READ_FUNC, bodylimit: number|undefined, header: HEADER_MAP, body: Uint8Array): Promise<[Uint8Array, HEADER_MAP]|undefined> {
    let size = 0;
    let result_buf = new Uint8Array(128);
    let result_sz = 0;
    while (true) {
        let sz;
        let r = await chunksize(readbytes, body, body.length);
        if (!r) {
            return;
        }
        [sz, body] = r!;
        if (sz == 0) {
            break;
        }
        size += sz;
        if (bodylimit && size > bodylimit) {
            return;
        }
        if (body.length >= sz) {
            result_buf = buffer_copy(result_buf, result_sz, body.subarray(0, sz));
            result_sz += sz;
            body = body.subarray(sz);
        } else {
            [body] = await readbytes(sz - body.length, body, body.length);
            result_buf = buffer_copy(result_buf, result_sz, body.subarray(0, sz));
            result_sz += sz;
            body = new Uint8Array();
        }

        body = (await readcrln(readbytes, body))!;
        if (body === undefined) {
            return;
        }
    }

    let tmpline = new Array<string>();
    body = (await recvheader(readbytes, tmpline, body, body.length))!;
    if (body === undefined) {
        return;
    }
    header = parseheader(tmpline, 0, header)!;

    return [result_buf.subarray(0, result_sz), header];
}

export async function request(socket_interface: SOCKET_INTERFACE, req: REQUEST_OPTIONS): Promise<[number, string, HEADER_MAP]> {
    let header_content = "";
    if (req.header) {
        req.header.set("host", req.header.get("host") || req.host);
        req.header.forEach((v, k) => {
            header_content += `${k}:${v}\r\n`;
        })
    } else {
        header_content = `host:${req.host}\r\n`;
    }
    
    let h = `${req.method} ${req.url} HTTP/1.1\r\n${header_content}content-length:${req.content && req.content.length || 0}\r\n\r\n`;
    socket_interface.write(h);
    if (req.content) {
        socket_interface.write(req.content);
    }

    let tmpline = new Array<string>();
    let body = await recvheader(socket_interface.read, tmpline, new Uint8Array(), 0);
    if (body === undefined) {
        throw new Error(http_helper.SOCKET_ERROR);
    }

    let statusline = tmpline[0];
    let r = statusline.match(/HTTP\/[\d\.]+\s+([\d]+)\s+(.*)$/);
    if (!r) {
        throw new Error(`Invalid HTTP header status`);
    }
    let code = Number(r[1]);
    
    let recv_header: HEADER_MAP = new Map();
    let header = parseheader(tmpline, 1, recv_header);
    if (!header) {
        throw new Error(`Invalid HTTP response header`);
    }
    
    let length = Number(header.get("content-length"));
    let mode = header.get("transfer-encoding");
    if (mode && mode != "identity" && mode != "chunked") {
        throw new Error(`Unsupport transfer-encoding`);
    }
    
    let body_length = body.length;
    if (mode == "chunked") {
        let r = await recvchunkedbody(socket_interface.read, 0, header, body);
        if (!r) {
            throw new Error(`Invalid response body`);
        }
        [body, header] = r;
        body_length = body.length;
    } else {
        if (length) {
            if (body.length < length) {
                [body] = await socket_interface.read(length - body.length, body, body_length);
            }
            body_length = length;
        } else if (code == 204 || code == 304 || code < 200) {
            body_length = 0;
        } else if (socket_interface.websocket && code == 101) {
            return [code, http_helper.decode_str(body, 0, body_length), recv_header]            
        } else {
            let [msg, sz] = await socket_interface.readall!(body, body_length);
            body = msg;
            body_length += sz;
        }
    }
    
    return [code, http_helper.decode_str(body, 0, body_length), recv_header]
}
