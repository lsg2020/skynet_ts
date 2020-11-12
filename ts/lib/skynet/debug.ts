import * as skynet from "skynet";
import * as lua_seri from "lua_seri";

let extern_dbgcmd = new Map<string, Function>();
export function reg_debugcmd(name: string, fn: Function) {
    let prev = extern_dbgcmd.get(name);
    extern_dbgcmd.set(name, fn);
    return prev;
}

let internal_info_func: Function|undefined = undefined;
export function info_func(func: Function) {
    let prev = internal_info_func;
    internal_info_func = func;
    return prev;
}

skynet.register_protocol({
    id: skynet.PTYPE_ID.DEBUG,
    name: skynet.PTYPE_NAME.DEBUG,
    pack: lua_seri.encode,
    unpack: lua_seri.decode,
    dispatch: _debug_dispatch,
})

let dbgcmd = new Map([
    [
        "MEM", 
        (context: skynet.CONTEXT) => {
            let mem = skynet.memory_info();
            skynet.retpack(context, Math.floor(mem.v8.total_heap_size / 1024));
        },
    ],
    [
        "GC",
        (context: skynet.CONTEXT) => {
            skynet.retpack(context, true);
        },
    ],
    [
        "STAT",
        (context: skynet.CONTEXT) => {
            skynet.retpack(context, {
                task: skynet.task(),
                mqlen: skynet.stat("mqlen"),
                cpu: skynet.stat("cpu"),
                message: skynet.stat("message"),
            })
        },
    ],
    [
        "TASK",
        (context: skynet.CONTEXT) => {
            skynet.retpack(context, {})
        },        
    ],
    [
        "INFO",
        async (context: skynet.CONTEXT, ...params: any[]) => {
            if (internal_info_func) {
                skynet.retpack(context, await internal_info_func(...params));
            } else {
                skynet.retpack(context, null);
            }
        },
    ],
    [
        "EXIT",
        async (context: skynet.CONTEXT, ...params: any[]) => {
            skynet.exit();
        },
    ],
    [
        "RUN",
        async (context: skynet.CONTEXT, ...params: any[]) => {
            skynet.retpack(context, null);
        },
    ],
    [
        "TERM",
        async (context: skynet.CONTEXT, ...params: any[]) => {
            skynet.term(params[0]);
        },
    ],
    [
        "SUPPORT",
        async (context: skynet.CONTEXT, ...params: any[]) => {
            skynet.retpack(context, skynet.dispatch(params[0]));
        },
    ],
    [
        "PING",
        async (context: skynet.CONTEXT, ...params: any[]) => {
            skynet.ret(context);
        },
    ],
    [
        "LINK",
        async (context: skynet.CONTEXT, ...params: any[]) => {
            skynet.response(context);
        },
    ],
]);
async function _debug_dispatch(context: skynet.CONTEXT, cmd: string, ...params: any[]) {
    let f = dbgcmd.get(cmd) || extern_dbgcmd.get(cmd);
    skynet.assert(f, cmd);
	await f!(context, ...params);
}