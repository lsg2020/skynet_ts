((window) => {
    const core = window.Deno.core;

    function command(cmd, param = "") {
        return core.jsonOpSync("op_skynet_command", { cmd: cmd, param: String(param) });
    }

    function addresscommand(cmd, param = "") {
        let r = command(cmd, param);
        if (!r || !r.result || r.result[0] != ":") {
            return 0;
        }

        return parseInt(r.result.slice(1), 16)
    }

    function intcommand(cmd, param = "") {
        let r = command(cmd, param);
        if (!r || !r.result) {
            return 0;
        }

        return Number(r.result)
    }

    function get_env(key, default_str) {
        let r = command("GETENV", key);
        if (!r || !r.result) {
            return default_str;
        }
        return r.result;
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
            let r = core.jsonOpSync("op_skynet_send", { dest: addr, ptype: ptype, session: session }, ...bufs);
            session = r.session;
        } else {
            let r = core.jsonOpSync("op_skynet_send_name", { name: addr, ptype: ptype, session: session }, ...bufs);
            session = r.session;
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
        let r = core.rawOpSync("op_skynet_now");
        return r;
    }

    function error(err) {
        core.jsonOpSync("op_skynet_error", { error: err });
    }

    function exit() {
        command("EXIT")
    }

    function genid() {
        return core.rawOpSync("op_skynet_genid");
    }

    function fetch_message(msg, sz, buffer) {
        let len = core.rawOpSync("op_skynet_fetch_message", msg, sz, buffer);
        return len;
    }

    function socket_connect(addr, port) {
        return core.rawOpSync("op_skynet_socket_connect", addr, port);
    }

    function socket_close(id) {
        core.rawOpSync("op_skynet_socket_close", id);
    }

    function socket_shutdown(id) {
        core.rawOpSync("op_skynet_socket_shutdown", id);
    }

    function socket_unpack(msg, sz) {
        return core.rawOpSync("op_skynet_socket_unpack", msg, sz);
    }

    function socket_bind(fd) {
        return core.rawOpSync("op_skynet_socket_bind", fd);
    }

    function socket_start(id) {
        core.rawOpSync("op_skynet_socket_start", id);
    }

    function socket_listen(host, port, backlog) {
        return core.rawOpSync("op_skynet_socket_listen", host, port, backlog);
    }

    function socket_udp(host, port) {
        return core.rawOpSync("op_skynet_socket_udp", host, port);
    }

    function socket_udp_connect(id, host, port) {
        core.rawOpSync("op_skynet_socket_udp_connect", id, host, port);
    }

    window.__bootstrap.skynet = {
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
        socket_connect,
        socket_close,
        socket_shutdown,
        socket_unpack,
        socket_bind,
        socket_start,
        socket_listen,
        socket_udp,
        socket_udp_connect,
    };
})(this);
