"use strict";

((window) => {
    const core = window.Deno.core;

    function command(cmd, param = "") {
        return core.opSync("op_skynet_command", { cmd: cmd, param: String(param) });
    }

    function addresscommand(cmd, param = "") {
        let r = command(cmd, param);
        if (!r || r[0] != ":") {
            return 0;
        }

        return parseInt(r.slice(1), 16)
    }

    function intcommand(cmd, param = "") {
        let r = command(cmd, param);
        if (!r) {
            return 0;
        }

        return Number(r)
    }

    function get_env(key, default_str) {
        let r = command("GETENV", key);
        if (!r) {
            return default_str;
        }
        return r;
    }

    function set_env(key, value) {
        command("SETENV", `${key} ${value}`);
    }

    function send(addr, ptype, session, ...bufs) {
        if (session == null) {
            // PTYPE_TAG_ALLOCSESSION
            ptype |= 0x20000
            session = 0
        }

        if (typeof (addr) == "number") {
            session = core.opSync("op_skynet_send", { dest: addr, ptype: ptype, session: session }, bufs);
        } else {
            session = core.opSync("op_skynet_send_name", { name: addr, ptype: ptype, session: session }, bufs);
        }
        if (session < 0) {
            if (session == -2) {
                return false;
            }
            return null;
        }
        return session;
    }

    function now() {
        let r = core.opSync("op_skynet_now");
        return r;
    }

    function error(err) {
        core.opSync("op_skynet_error", err);
    }

    function exit() {
        command("EXIT")
    }

    function genid() {
        return core.opSync("op_skynet_genid");
    }

    function fetch_message(msg, sz, buffer, offset) {
        let len = core.opRawSync("op_skynet_fetch_message", msg, sz, buffer, offset);
        return len;
    }

    function free(msg) {
        core.opRawSync("op_skynet_free", msg);
    }

    function socket_connect(addr, port) {
        return core.opSync("op_skynet_socket_connect", { addr: addr, port: port });
    }

    function socket_close(id) {
        core.opSync("op_skynet_socket_close", id);
    }

    function socket_shutdown(id) {
        core.opSync("op_skynet_socket_shutdown", id);
    }

    function socket_unpack(ptr1, ptr2, sz) {
        return core.opRawSync("op_skynet_socket_unpack", ptr1, ptr2, sz);
    }

    function socket_bind(fd) {
        return core.opSync("op_skynet_socket_bind", fd);
    }

    function socket_start(id) {
        core.opSync("op_skynet_socket_start", id);
    }

    function socket_listen(host, port, backlog) {
        return core.opSync("op_skynet_socket_listen", { host, port, backlog });
    }

    function socket_udp(host, port) {
        return core.opSync("op_skynet_socket_udp", { host, port });
    }

    function socket_udp_connect(id, host, port) {
        core.opSync("op_skynet_socket_udp_connect", { id, host, port });
    }

    function alloc_msg(...buffers) {
        return core.opRawSync("op_skynet_alloc_msg", ...buffers);
    }

    function socket_send(id, msg, len) {
        return core.opRawSync("op_skynet_socket_send", id, msg, len);
    }

    function socket_send_lowpriority(id, msg, len) {
        return core.opRawSync("op_skynet_socket_send_lowpriority", id, msg, len);
    }

    function socket_sendto(id, address, msg, len) {
        return core.opRawSync("op_skynet_socket_sendto", id, address, msg, len);
    }

    function socket_nodelay(id) {
        core.opSync("op_skynet_socket_nodelay", id);
    }

    function shared_bs() {
        return core.opRawSync("op_skynet_shared_bs");
    }

    function shared_bs_temp() {
        return core.opRawSync("op_skynet_shared_bs_temp");
    }

    function callback(cb) {
        core.opRawSync("op_skynet_callback", cb);
    }

    function set_jslib_paths(paths) {
        return core.opSync("op_skynet_set_jslib_paths", paths);
    }

    let skynet = {
        command,
        get_env,
        set_env,
        send,
        now,
        error,
        exit,
        addresscommand,
        intcommand,
        genid,
        fetch_message,
        free,
        shared_bs,
        shared_bs_temp,
        callback,
        set_jslib_paths,
        alloc_msg,


        socket_connect,
        socket_close,
        socket_shutdown,
        socket_unpack,
        socket_bind,
        socket_start,
        socket_listen,
        socket_udp,
        socket_udp_connect,
        socket_send,
        socket_send_lowpriority,
        socket_sendto,
        socket_nodelay,
    };
    window.Skynet = skynet;
    window.__bootstrap.Skynet = skynet;
})(this);
