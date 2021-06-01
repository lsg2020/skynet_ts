((window) => {
    const core = window.Deno.core;

    function v8inspector_connect(proxy_addr, proto_ptype, pause_addr, resume_addr) {
        return core.opRawSync("op_v8inspector_connect", proxy_addr, proto_ptype, pause_addr, resume_addr);
    }

    function v8inspector_disconnect(session_id) {
        core.opRawSync("op_v8inspector_disconnect", session_id);
    }

    function v8inspector_message(session_id, msg) {
        core.opRawSync("op_v8inspector_message", session_id, msg)
    }

    let V8Inspector = {
        v8inspector_connect,
        v8inspector_disconnect,
        v8inspector_message,
    }
    window.V8Inspector = V8Inspector;
    window.__bootstrap.V8Inspector = V8Inspector;
})(this);
