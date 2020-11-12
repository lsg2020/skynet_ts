import * as skynet from "skynet"

enum MSGID {
    add = "add",
    sleep = "sleep",
    call = "call",
}
interface MSGTYPE {
    [MSGID.add]: (context: skynet.CONTEXT, a: number, b: number) => void,
    [MSGID.sleep]: (context: skynet.CONTEXT, ti: number) => void,
    [MSGID.call]: (context: skynet.CONTEXT, name: string, cmd: string, ...params: number[]) => void,
}

let handles = new Map<string, Function>();
function reg<K extends keyof MSGTYPE>(k: K, func: MSGTYPE[K]) {
    handles.set(k, func);
}

reg(MSGID.add, (context: skynet.CONTEXT, a: number, b: number) => {
    skynet.retpack(context, {result: a+ b}, a, b)
})

reg(MSGID.sleep, async (context: skynet.CONTEXT, ti: number) => {
    let response = skynet.response(context)
    await skynet.sleep(ti)
    response(true, ti)
})

reg(MSGID.call, async (context: skynet.CONTEXT, name: string, cmd: string, ...params: number[]) => {
    let response = skynet.response(context)
    let ret = await skynet.call(name, "lua", cmd, ...params)
    response(true, ret)
})

export function register(reg: Map<string, Function>) {
    for (let [k, fun] of handles) {
        reg.set(k, fun);
    }
}