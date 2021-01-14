import * as socket from "skynet/socket"
import * as skynet from "skynet"

export type CHANNEL_OPS = {
    host: string,
    port: number,
    backup?: Array<ADDRESS>,
    auth?: (channel: Channel)=>void,
    nodelay?: boolean,
    overload?: boolean,
}

export type ADDRESS = string|ADDRESS_EX;
export type ADDRESS_EX = {host: string, port: number};
export type REQUEST_FN = (sock: Channel) => Promise<[boolean, any]>;

let socket_error = "SOCKET_ERROR";

export class Channel {
    private _closed = false;
    private _host = "";
    private _port = 0;
    private _socket = 0;
    private _connecting?: Array<number>;
    private _backup?: Array<ADDRESS>;
    private _nodelay?: boolean;
    private _dispatch_thread: boolean = false;
    private _request = new Array<REQUEST_FN>();
    private _thread = new Array<number>();
    private _wait_response = 0;
    private _result = new Map<number, any>();
    private _result_data = new Map<number, any>();
    private _overload_notify?: (flag: boolean) => void;
    private _auth?: (channel: Channel) => void;
    private _response?: (fd: number) => [number, boolean, Uint8Array];

    constructor(ops: CHANNEL_OPS) {
        this._host = ops.host;
        this._port = ops.port;
        this._auth = ops.auth;
        this._backup = ops.backup;
        this._nodelay = ops.nodelay;

    }

    public async connect(once?: boolean) {
        this._closed = false;
        return await this.block_connect(once);
    }

    public async request(request: Uint8Array, response?: REQUEST_FN, padding?: Array<Uint8Array>) {
        await this.block_connect(true);
        if (padding) {
            // padding may be a table, to support multi part request
            // multi part request use low priority socket write
            // now socket_lwrite returns as socket_write    
            if (!socket.lwrite(this._socket, request)) {
                this.sock_err();
            }
            padding.forEach((buff) => {
                if (!socket.lwrite(this._socket, buff)) {
                    this.sock_err();
                }
            })
        } else {
            if (!socket.write(this._socket, request)) {
                this.sock_err();
            }
        }

        if (!response) {
            // no response
            return;
        }

        return this.wait_for_response(response);
    }

    public async response(response: REQUEST_FN) {
        await this.block_connect();
        return this.wait_for_response(response);
    }

    public close() {
        if (!this._closed) {
            this.term_dispatch_thread();
            this._closed = true;
            this.close_channel_socket();
        }
    }

    public change_host(host: string, port?: number) {
        this._host = host;
        if (port) {
            this._port = port;
        }

        if (!this._closed) {
            this.close_channel_socket();
        }
    }

    public change_backup(backup: Array<ADDRESS>) {
        this._backup = backup;
    }

    public async read(sz?: number, buffer?: Uint8Array, offset?: number) {
        try {
            return await socket.read(this._socket, sz, buffer, offset);
        } catch (e) {
            throw new Error(socket_error);
        }
    }

    public async readline(sep?: string, buffer?: Uint8Array, offset?: number) {
        try {
            return await socket.readline(this._socket, sep, buffer, offset);
        } catch (e) {
            throw new Error(socket_error);
        }
    }

    private sock_err() {
        this.close_channel_socket();
        this.wakeup_all("");
        throw new Error(socket_error);
    }

    private async wait_for_response(response: REQUEST_FN) {
        let token = skynet.gen_token();
        this.push_response(response, token);
        await skynet.wait(token);

        let result = this._result.get(token);
        let result_data = this._result_data.get(token);
        this._result.delete(token);
        this._result_data.delete(token);

        if (result == socket_error) {
            throw new Error(result_data || socket_error);
        } else {
            skynet.assert(result, result_data);
            return result_data;
        }
    }

    private close_channel_socket() {
        if (this._socket) {
            let sock = this._socket;
            this._socket = 0;
            socket.close(sock);
        }
    }

    private wakeup_all(errmsg: string) {
        if (this._response) {
            this._thread.forEach((token) => {
                this._result.set(token, socket_error);
                this._result_data.set(token, errmsg);
                skynet.wakeup(token);                
            });
            this._thread = [];
        } else {
            this._request = [];
            this._thread.forEach((token) => {
                this._result.set(token, socket_error);
                this._result_data.set(token, errmsg);
                skynet.wakeup(token);
            });
            this._thread = [];
        }
    }

    private dispatch_by_session() {
        // TODO
    }

    private async pop_response(): Promise<[REQUEST_FN, number]> {
        while (true) {
            if (this._request.length && this._thread.length) {
                return [this._request.shift()!, this._thread.shift()!];
            }
            
            this._wait_response = skynet.gen_token();
            await skynet.wait(this._wait_response);
        }
    }

    private push_response(response: number|REQUEST_FN, token: number) {
        if (this._response) {
            // response is session
            this._thread[response as number] = token;
        } else {
            // response is a function, push it to __request
            this._request.push(response as REQUEST_FN);
            this._thread.push(token);
            if (this._wait_response) {
                let token = this._wait_response;
                this._wait_response = 0;
                skynet.wakeup(token);
            }
        }
    }

    private async get_response(func: REQUEST_FN): Promise<[boolean, any]> {
        let [result_ok, d] = await func(this);
        return [result_ok, d];
    }

    private async dispatch_by_order() {
        while (this._socket) {
            let [func, token] = await this.pop_response();
            if (!token) {
                // close signal
                this.wakeup_all("channel_closed");
                break;
            }

            try {
                let [result_ok, result_data] = await this.get_response(func);
                this._result.set(token, result_ok);
                this._result_data.set(token, result_data);
                skynet.wakeup(token);
            } catch (e) {
                this.close_channel_socket();
                let errmsg = "";
                if (e.message != socket_error) {
                    errmsg = e.message;
                }

                this._result.set(token, socket_error);
                this._result_data.set(token, errmsg);
                skynet.wakeup(token);
                this.wakeup_all(errmsg);
            }
        }
    }

    private term_dispatch_thread() {
        if (!this._response && this._dispatch_thread) {
            // dispatch by order, send close signal to dispatch thread
            this.push_response(0, 0);
        }
    }

    private async connect_once() {
        if (this._closed) {
            return false
        }

        let addr_list = new Array<ADDRESS_EX>();
        let addr_set = new Set<string>();

        let _add_backup = () => {
            this._backup && this._backup.forEach((addr) => {
                let host, port;
                if (typeof(addr) == "string") {
                    host = addr as string;
                    port = this._port;
                } else {
                    host = (addr as ADDRESS_EX).host;
                    port = (addr as ADDRESS_EX).port;
                }
    
                let hostkey = `${host}:${port}`;
                if (!addr_set.has(hostkey)) {
                    addr_set.add(hostkey);
                    addr_list.push({host, port});
                }
            });
        };

        let _next_addr = () => {
            let addr = addr_list.shift();
            if (addr) {
                skynet.error(`socket: connect to backup host ${addr.host}:${addr.port}`);
            }
            return addr
        };

        let _connect_once: (addr: ADDRESS_EX) => void;
        _connect_once = async (addr: ADDRESS_EX) => {
            let fd = 0;
            let err;
            try {
                fd = await socket.open(addr.host, addr.port);
            } catch (e) {
                err = e;
            }
            if (!fd) {
                // try next one
                let addr = _next_addr();
                if (!addr) {
                    throw err;
                }
                return _connect_once(addr);
            }

            this._host = addr.host;
            this._port = addr.port;

            skynet.assert(!this._socket);
            this.term_dispatch_thread();

            this._nodelay && socket.nodelay(fd);

            // register overload warning
            if (this._overload_notify) {
                let overload_trigger = (id: number, size: number) => {
                    // TODO
                }
                socket.warning(fd, overload_trigger);
            }

            while (this._dispatch_thread) {
                await skynet.sleep(1);
            }

            this._socket = fd;
            this._dispatch_thread = true;
            let dispatch_fn = async() => {
                try {
                    if (this._response) {
                        await this.dispatch_by_session();
                    } else {
                        await this.dispatch_by_order();
                    }
                } finally {
                    this._dispatch_thread = false;
                }
            }
            dispatch_fn();

            if (this._auth) {
                try {
                    await this._auth(this);
                    if (!this._socket) {
                        // auth may change host, so connect again
                        return this.connect_once();
                    }
                } catch (e) {
                    this.close_channel_socket();
                    if (e.message != socket_error) {
                        skynet.error(`socket: auth failed ${e.message}`);
                    }

                    // auth failed, try next addr
                    _add_backup();
                    let next_addr = _next_addr();
                    if (!next_addr) {
                        throw new Error(`no more backup host`);
                    }
                    return _connect_once(next_addr!);
                }
            }

            return true;
        };

        _add_backup();
        return await _connect_once({host: this._host, port: this._port});
    }

    private async try_connect(once?: boolean) {
        let t = 0;
        while (!this._closed) {
            try {
                await this.connect_once()
                if (!once) {
                    skynet.error(`socket: connect to ${this._host}:${this._port}`);                    
                }
                return;
            } catch(e) {
                if (once) {
                    return e.message as string;
                }
                skynet.error(`socket: connect ${e.message}`);
            }

            if (t > 1000) {
                skynet.error(`socket: try to reconnect ${this._host}:${this._port}`);
                await skynet.sleep(t);
                t = 0;
            } else {
                await skynet.sleep(t);
            }
            t += 100;
        }
    }

    private check_connect() {
        if (this._socket) {
            if (socket.disconnected(this._socket)) {
                // closed by peer
                skynet.error(`socket: disconnect detected ${this._host}:${this._port}`);
                this.close_channel_socket();
                return;
            }
            
            return true;
        }
        if (this._closed) {
            return false;
        }
        return;
    }

    private async block_connect(once?: boolean) {
        let r = this.check_connect();
        if (r !== undefined) {
            return r;
        }
        
        let err;
        if (this._connecting) {
            let token = skynet.gen_token();
            this._connecting.push(token);
            await skynet.wait(token);
        } else {
            this._connecting = new Array<number>();
            err = await this.try_connect(once);
            let connect_token = this._connecting;
            this._connecting = undefined;
            connect_token.forEach((token) => skynet.wakeup(token));
        }

        r = this.check_connect();
        if (r === undefined) {
            skynet.error(`Connect to ${this._host}:${this._port} ${err}`);
            throw new Error(err);
        }
        
        return r;
    }
}

