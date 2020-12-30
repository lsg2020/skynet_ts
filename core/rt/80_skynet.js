((window) => {
    const core = window.Deno.core;

    function command(cmd, param = "") {
        return core.rawOpSync("op_skynet_command", cmd, String(param));
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
            session = core.rawOpSync("op_skynet_send", addr, ptype, session, ...bufs);
        } else {
            session = core.rawOpSync("op_skynet_send_name", addr, ptype, session, ...bufs);
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
        core.rawOpSync("op_skynet_error", err);
    }

    function exit() {
        command("EXIT")
    }

    function genid() {
        return core.rawOpSync("op_skynet_genid");
    }

    function fetch_message(msg, sz, buffer, offset) {
        let len = core.rawOpSync("op_skynet_fetch_message", msg, sz, buffer, offset);
        return len;
    }

    function free(msg) {
        core.rawOpSync("op_skynet_free", msg);
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

    function socket_alloc_msg(...buffers) {
        return core.rawOpSync("op_skynet_socket_alloc_msg", ...buffers);
    }

    function socket_send(id, msg, len) {
        return core.rawOpSync("op_skynet_socket_send", id, msg, len);
    }

    function socket_send_lowpriority(id, msg, len) {
        return core.rawOpSync("op_skynet_socket_send_lowpriority", id, msg, len);
    }

    function socket_sendto(id, address, msg, len) {
        return core.rawOpSync("op_skynet_socket_sendto", id, address, msg, len);
    }

    function socket_nodelay(id) {
        core.rawOpSync("op_skynet_socket_nodelay", id);
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
        free,
        socket_connect,
        socket_close,
        socket_shutdown,
        socket_unpack,
        socket_bind,
        socket_start,
        socket_listen,
        socket_udp,
        socket_udp_connect,
        socket_alloc_msg,
        socket_send,
        socket_send_lowpriority,
        socket_sendto,
        socket_nodelay,
    };
})(this);
