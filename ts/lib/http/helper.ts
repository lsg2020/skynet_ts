import * as skynet from "skynet"
import * as socket from "skynet/socket"
import { SOCKET_INTERFACE } from "http/types"

import { utf8 } from "utf8"

let readbytes = socket.read;
let writebytes = socket.write;

export let SOCKET_ERROR = "[Socket Error]";

export function readfunc(fd: number) {
    return async (sz?: number, buffer?: Uint8Array, offset?: number): Promise<[Uint8Array, number]> => {
        let [ret, msg, len] = await readbytes(fd, sz, buffer, offset);
        if (ret) {
            return [msg!, len!];
        } else {
            throw new Error(SOCKET_ERROR);
        }
    }
}

export const readall = socket.readall;

export function writefunc(fd: number) {
    return (content: string|Uint8Array[]) => {
        let ok = writebytes(fd, content as string);
        if (!ok) {
            throw new Error(SOCKET_ERROR);
        }
    }
}

export function close(fd: number) {
    socket.close(fd);
}

export function shutdown(fd: number) {
    socket.shutdown(fd);
}

export async function connect(host: string, port: number, timeout: number) {
    if (timeout) {
        let token = skynet.gen_token();
        let fd = 0;
        let drop_fd = false;
        let async_conn = async () => {
            fd = await socket.open(host, port);
            if (drop_fd) {
                socket.close(fd);
            } else {
                skynet.wakeup(token);
            }
        }
        async_conn();
        await skynet.sleep(timeout, token);
        if (!fd) {
            drop_fd = true;
        }
        return fd;        
    }

    let fd = await socket.open(host, port);
    return fd;
}

export function gen_interface(fd: number, is_https: boolean) {
    skynet.assert(!is_https, "not support https");
    let socket_interface: SOCKET_INTERFACE = {
        read: readfunc(fd),
        write: writefunc(fd),
        readall: (buffer?: Uint8Array, offset?: number) => {
            return socket.readall(fd, buffer, offset)
        },
    }
    return socket_interface;
}

export function decode_str(buffer: Uint8Array, start: number, end: number) {
    // String.fromCharCode.apply(null, Array.from(buffer.slice(start, end)))
    return utf8.read(buffer, start, end);
}