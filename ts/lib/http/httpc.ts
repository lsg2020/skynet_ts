
import * as skynet from "skynet";
import * as dns from "skynet/dns";
import * as http_helper from "http/helper";
import { SOCKET_INTERFACE, HEADER_MAP } from "http/types"
import { recvheader, parseheader, recvchunkedbody } from "http/internal";

enum PROTOCOL_TYPE {
    HTTP = "http",
    HTTPS = "https",
}

export type REQUEST_OPTIONS = {
    method: string,
    host: string,
    url: string,
    header?: HEADER_MAP,
    content?: string,
    timeout?: number,
}

function check_protocol(host: string): [PROTOCOL_TYPE, string] {
    let r = host.match(/^[Hh][Tt][Tt][Pp][Ss]?:\/\//);
    if (r) {
        let protocol = r[0].toLowerCase();
        host = host.slice(protocol.length);
        if (protocol == "https://") {
            return [PROTOCOL_TYPE.HTTPS, host];
        } else if (protocol == "http://") {
            return [PROTOCOL_TYPE.HTTP, host];
        } else {
            throw new Error(`unknown protocol: ${protocol}`);
        }
    } else {
        return [PROTOCOL_TYPE.HTTP, host];
    }
}

async function _request(socket_interface: SOCKET_INTERFACE, req: REQUEST_OPTIONS): Promise<[number, string]> {
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
    let r = statusline.match(/HTTP\/[\d\.\s]+([\d]+)\s+(.*)$/);
    if (!r) {
        throw new Error(`Invalid HTTP header status`);
    }
    let code = Number(r[1]);
    
    let recv_header: HEADER_MAP = new Map();
    let header = parseheader(tmpline, 2, recv_header);
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
        } else {
            let [msg, sz] = await socket_interface.readall!(body, body_length);
            body = msg;
            body_length += sz;
        }
    }
    
    return [code, http_helper.decode_str(body, 0, body_length)]
}

export let HTTPC_CONF = {
    default_timeout: 500,
}

export async function request(req: REQUEST_OPTIONS): Promise<[number, string]> {
    let timeout = req.timeout === undefined ? HTTPC_CONF.default_timeout : req.timeout;
    let protocol;
    [protocol, req.host] = check_protocol(req.host);
    let r = req.host.match(/([^:]+):?(\d*)$/);
    skynet.assert(r);
    let hostname = r![1];
    let port = Number(r![2]) || protocol == PROTOCOL_TYPE.HTTP && 80 || protocol == PROTOCOL_TYPE.HTTPS && 443 || 0;
    if (!hostname.match(/.*\d+$/)) {
        let [r, err] = await dns.resolve(hostname, dns.QTYPE.A);
        if (err) {
            throw new Error(`dns resolve ${hostname} error:${err}`);
        }
        hostname = r!.address;
    }
    let fd = await http_helper.connect(hostname, port, timeout);
    if (!fd) {
        throw new Error(`${protocol} connect error host:${hostname} port:${port} timeout:${timeout}`);
    }
    let socket_interface = http_helper.gen_interface(fd, protocol == PROTOCOL_TYPE.HTTPS);
    let finish = false;

    if (timeout) {
        skynet.timeout(timeout, () => {
            if (!finish) {
                http_helper.shutdown(fd);
                socket_interface.close && socket_interface.close();
            }
        });
    }
    socket_interface.init && socket_interface.init();

    try {
        let [code, body] = await _request(socket_interface, req);
        return [code, body];
    } finally {
        finish = true;
        http_helper.close(fd);
        socket_interface.close && socket_interface.close();    
    }    
}