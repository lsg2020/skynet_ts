
import * as skynet from "skynet";
import * as dns from "skynet/dns";
import * as http_helper from "http/helper";
import * as internal from "http/internal";
import { REQUEST_OPTIONS } from "http/types"

enum PROTOCOL_TYPE {
    HTTP = "http",
    HTTPS = "https",
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
        let [code, body] = await internal.request(socket_interface, req);
        return [code, body];
    } finally {
        finish = true;
        http_helper.close(fd);
        socket_interface.close && socket_interface.close();    
    }    
}