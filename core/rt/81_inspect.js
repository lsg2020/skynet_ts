((window) => {
    const core = window.Deno.core;

    function v8inspect_connect(proxy_addr, proto_ptype, pause_addr, resume_addr) {
        return core.rawOpSync("op_v8inspector_connect", proxy_addr, proto_ptype, pause_addr, resume_addr);
    }

    function v8inspect_disconnect(session_id) {
        core.rawOpSync("op_v8inspector_disconnect", session_id);
    }

    window.__bootstrap.v8inspect = {
        v8inspect_connect,
        v8inspect_disconnect,
    };
})(this);
