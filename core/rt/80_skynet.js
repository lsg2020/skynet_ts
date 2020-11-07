((window) => {
    const core = window.Deno.core;

    function command(cmd, param) {
        return core.jsonOpSync("op_skynet_command", { cmd: cmd, param: String(param) });
    }

    function get_env(key, default_str) {
        let r = command("GETENV", key);
        if (!r || !r.result) {
            return default_str;
        }
        return r.result;
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
        return r
    }

    function error(err) {
        core.jsonOpSync("op_skynet_error", { error: err });
    }

    function exit() {
        command("EXIT")
    }

    window.__bootstrap.skynet = {
        command,
        get_env,
        send,
        now,
        error,
        exit,
    };
})(this);
