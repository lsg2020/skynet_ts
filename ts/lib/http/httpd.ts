
const http_status_msg: any = {
	[100]: "Continue",
	[101]: "Switching Protocols",
	[200]: "OK",
	[201]: "Created",
	[202]: "Accepted",
	[203]: "Non-Authoritative Information",
	[204]: "No Content",
	[205]: "Reset Content",
	[206]: "Partial Content",
	[300]: "Multiple Choices",
	[301]: "Moved Permanently",
	[302]: "Found",
	[303]: "See Other",
	[304]: "Not Modified",
	[305]: "Use Proxy",
	[307]: "Temporary Redirect",
	[400]: "Bad Request",
	[401]: "Unauthorized",
	[402]: "Payment Required",
	[403]: "Forbidden",
	[404]: "Not Found",
	[405]: "Method Not Allowed",
	[406]: "Not Acceptable",
	[407]: "Proxy Authentication Required",
	[408]: "Request Time-out",
	[409]: "Conflict",
	[410]: "Gone",
	[411]: "Length Required",
	[412]: "Precondition Failed",
	[413]: "Request Entity Too Large",
	[414]: "Request-URI Too Large",
	[415]: "Unsupported Media Type",
	[416]: "Requested range not satisfiable",
	[417]: "Expectation Failed",
	[500]: "Internal Server Error",
	[501]: "Not Implemented",
	[502]: "Bad Gateway",
	[503]: "Service Unavailable",
	[504]: "Gateway Time-out",
	[505]: "HTTP Version not supported",
};

import * as internal from "http/internal"
import * as http_helper from "http/helper"
import * as skynet from "skynet"
import { HEADER_MAP, READ_FUNC } from "http/types"

export async function read_request(readbytes: READ_FUNC, bodylimit?: number): Promise<[number, string?, string?, HEADER_MAP?, string?]> {
    let tmpline = new Array<string>();
    let body = await internal.recvheader(readbytes, tmpline, new Uint8Array(), 0);
    if (body === undefined) {
        return [413];
    }

    let request = skynet.assert(tmpline[0]);
    let r = request.match(/^(\w+)\s+(.+)\s+HTTP\/([\d\.]+)/);
    skynet.assert(r);
    let [method, url, httpver] = [r![1], r![2], Number(r![3])];
    if (httpver < 1.0 || httpver > 1.1) {
        return [505];
    }

    let header = internal.parseheader(tmpline, 1, new Map());
    if (!header) {
        return [400];
    }

    let length = Number(header.get("content-length"));
    let mode = header.get("transfer-encoding");
    if (mode && mode != "identity" && mode != "chunked") {
        return [501];
    }

    let body_length = body.length;
    if (mode == "chunked") {
        let r = await internal.recvchunkedbody(readbytes, bodylimit!, header, body);
        if (!r) {
            return [413];
        }
        [body, header] = r!;
        body_length = body.length;
    } else {
        if (length) {
            if (bodylimit && length > bodylimit) {
                return [413]
            }
            if (body.length < length) {
                [body] = await readbytes(length - body.length, body, body.length);
            }
            body_length = length;
        }
    }
    
    return [200, url, method, header, http_helper.decode_str(body!, 0, body_length)];
}

export function write_response(writefunc: (content: string)=>void, statuscode: number, bodyfunc: Function|string, header?: HEADER_MAP) {
    let statusline = `HTTP/1.1 ${statuscode} ${http_status_msg[statuscode] || ""}\r\n`;
    writefunc(statusline);
    if (header) {
        for (let [k, v] of header) {
            let t = typeof(v);
            if (t == "object") {
                for (let vv of v as string[]) {
                    writefunc(`${k}: ${vv}\r\n`);
                }
            } else {
                writefunc(`${k}: ${v}\r\n`);
            }
        }
    }

    let t = typeof(bodyfunc);
    if (t == "string") {
        writefunc(`content-length: ${(bodyfunc as string).length}\r\n\r\n`);
        writefunc(bodyfunc as string);
    } else if(t == "function") {
        writefunc(`transfer-encoding: chunked\r\n`);
        while (true) {
            let s = (bodyfunc as ()=>string)();
            if (s) {
                writefunc(`\r\n${s.length.toString(16)}\r\n`);
                writefunc(s);
            } else {
                writefunc(`\r\n0\r\n\r\n`);
                break;
            }
        }
    } else {
        writefunc("\r\n");
    }
}
