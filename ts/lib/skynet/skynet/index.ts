import * as pack from "pack";

let skynet_rt = Skynet;

let proto = new Map<string|number, PROTOCOL_TYPE>();
export let PTYPE_ID = {
	// read skynet.h
	TEXT: 0,
	RESPONSE: 1,
	MULTICAST: 2,
	CLIENT: 3,
	SYSTEM: 4,
	HARBOR: 5,
	SOCKET: 6,
	ERROR: 7,
	QUEUE: 8,	// used in deprecated mqueue, use skynet.queue instead
	DEBUG: 9,
	LUA: 10,
	SNAX: 11,
	TRACE: 12,	// use for debug trace
}
export let PTYPE_NAME = {
    TEXT: "text",
    LUA: "lua",
    RESPONSE: "response",
    ERROR: "error",
    DEBUG: "debug",
    SOCKET: "socket",
}

type PROTOCOL_TYPE = {
    name: string,
    id: number,
    pack?: (...obj: any) => Uint8Array,
    unpack?: (buf: Uint8Array, offset: number, sz: number) => any[],
    dispatch?: Function,
};
export type CONTEXT = {
    proto: PROTOCOL_TYPE,
    session: number,
    source: number,
    dispatch_id: number,
};


type SERVICE_ADDR = number | string;    // service_addr|service_name

let session_id_callback = new Map<number, [Function, Function, boolean?]>();  // session -> [resolve, reject, wakeup]
let watching_response = new Map<number, SERVICE_ADDR>();     // session -> addr
let watching_request = new Map<number, SERVICE_ADDR>();     // session -> addr
let unresponse = new Map<Function, SERVICE_ADDR>();   // call session -> [addr, reject]
let sleep_session = new Map<number, number>();  // token -> session
let next_dispatch_id = 1;

type UNKNOWN_REQUEST_FUNC = (session: number, source: number, msg: Uint8Array, prototype: number) => void;
let _unknow_request: UNKNOWN_REQUEST_FUNC = function (session: number, source: number, msg: Uint8Array, prototype: number) {
    skynet_rt.error(`Unknown request (${prototype}): ${msg.length}`);
    throw new Error(`Unknown session : ${session} from ${source.toString(16)}`);
}
export function dispatch_unknown_request(unknown: UNKNOWN_REQUEST_FUNC) {
    let prev = _unknow_request;
    _unknow_request = unknown;
    return prev;
}
type UNKNOWN_RESPONSE_FUNC = (session: number, source: number, msg: Uint8Array) => void;
let _unknow_response: UNKNOWN_RESPONSE_FUNC = function (session: number, source: number, msg: Uint8Array) {
    skynet_rt.error(`Response message : ${msg.length}`);
    throw new Error(`Unknown session : ${session} from ${source.toString(16)}`);
}
export function dispatch_unknown_response(unknown: UNKNOWN_RESPONSE_FUNC) {
    let prev = _unknow_response;
    _unknow_response = unknown;
    return prev;
}

export function ignoreret(session: number) {
    watching_response.delete(session);
}

// monitor exit
function _error_dispatch(error_session: number, error_source: SERVICE_ADDR) {
    if (error_session === 0) {
        // error_source is down, clear unreponse set
        for (let [resp, addr] of unresponse) {
            if (addr == error_source) {
                unresponse.delete(resp);
            }
        }
        
        for (let [session, addr] of watching_request) {
            if (addr == error_source) {
                watching_request.delete(session);
                _error_dispatch(session, error_source);
            }
        }
    } else {
        // capture an error for error_session
        ignoreret(error_session);
        let response_func = session_id_callback.get(error_session);
        if (response_func) {
            session_id_callback.delete(error_session);
            response_func[1]();
        }
    }
}

const SHARED_MIN_SZ = 128;
let shared_bytes: Uint8Array;
export function alloc_buffer(size: number, new_buffer?: true): Uint8Array;
export function alloc_buffer(size: number, from?: Uint8Array): Uint8Array;
export function alloc_buffer(size: number, from?: Uint8Array|true): Uint8Array {
    if (!from || from === true) {
        size = size < SHARED_MIN_SZ ? SHARED_MIN_SZ : size;
    }
    let dst = !from ? shared_bytes : (from === true ? new Uint8Array(size) : from);

    if (!dst || dst.length < size) {
        let alloc_sz = dst ? size * 2 : size;
        let new_dst = new Uint8Array(alloc_sz);
        if (from) {
            new_dst.set(from as Uint8Array);
        }
        if (shared_bytes == dst) {
            shared_bytes = new_dst;
        }
        dst = new_dst;
    }
    return dst;
}

export function gen_token() {
    let token = next_dispatch_id++;
    if (token >= 0xffffffff) {
        next_dispatch_id = 1;
    }
    return token;
}

let shared_bs: Uint8Array;
export function get_shared_bs(is_new_bs: boolean) {
    if (!shared_bs || is_new_bs) {
        shared_bs = new Uint8Array(skynet_rt.shared_bs());
    }
    return shared_bs;
}
let cur_msgptr: Uint8Array = new Uint8Array(8);
let cur_msgptr_1: number = 0;
let cur_msgptr_2: number = 0;
export function get_cur_msgptr(): [number, number] {
    if (!cur_msgptr_1 && !cur_msgptr_2) {
        cur_msgptr_1 = pack.decode_uint32(cur_msgptr, 0, true);
        cur_msgptr_2 = pack.decode_uint32(cur_msgptr, 4, true);
    }
    return [cur_msgptr_1, cur_msgptr_2];
}
async function dispatch_message(is_new_bs: boolean) {
    let shared_buf = get_shared_bs(is_new_bs);
    let prototype = pack.decode_uint32(shared_buf, 0, true);
    let session = pack.decode_uint32(shared_buf, 4, true);
    let source = pack.decode_uint32(shared_buf, 8, true);
    let sz = pack.decode_uint32(shared_buf, 12, true);
    cur_msgptr_1 = 0;
    cur_msgptr_2 = 0;
    pack.decode_rawbuf(shared_buf, 16, 8, cur_msgptr);
    //cur_msgptr = pack.decode_biguint(shared_buf, 16, 8, true);
    let offset = 64;

    if (prototype == PTYPE_ID.RESPONSE) {
        let response_func = session_id_callback.get(session);
        if (!response_func) {
            return _unknow_response(session, source, shared_buf.slice(offset, offset+sz));
        }
        session_id_callback.delete(session);
        if (!response_func[2])
            response_func[0]([shared_buf, offset, sz]);
    } else {
        let p = proto.get(prototype);

        if (!p || !p.dispatch) {
            if (session != 0) {
                return skynet_rt.send(source, PTYPE_ID.ERROR, session);
            }
            return _unknow_request(session, source, shared_buf.slice(offset, offset+sz), prototype);
        }
        let context: CONTEXT = {
            proto: p,
            session,
            source,
            dispatch_id: gen_token(),
        }
        if (session) { watching_response.set(session, source); }
        await p.dispatch!(context, ...p.unpack!(shared_buf, offset, sz));
        if (session && watching_response.has(session)) {
            watching_response.delete(session);
            skynet_rt.error(`Maybe forgot response session:${session} proto:${p.name} source:${source}`);
        }
    }
}

export function timeout(ti: number, func: Function) {
    let session = Number(skynet_rt.command("TIMEOUT", ti));
    assert(session);
    assert(!session_id_callback.has(session));
    session_id_callback.set(session, [func, func]);
}

export async function sleep(ti: number, token?: number) {
    token = token || gen_token();
    let session = Number(skynet_rt.command("TIMEOUT", ti));
    sleep_session.set(token, session);

    let promise = new Promise((resolve, reject) => {
        session_id_callback.set(session, [resolve, reject]);
    })
    await promise;
    sleep_session.delete(token);
}

export async function wait(token: number) {
    let session = skynet_rt.genid()
    sleep_session.set(token, session);
    let promise = new Promise((resolve, reject) => {
        session_id_callback.set(session, [resolve, reject]);
    })

    await promise;
    sleep_session.delete(token);
    session_id_callback.delete(session);
}

export function wakeup(token: number) {
    let session = sleep_session.get(token);
    assert(session);
    let response_func = session_id_callback.get(session!);
    assert(response_func);
    response_func![0]();
    response_func![2] = true; // BREAK
}

export function self() {
    return skynet_rt.addresscommand("REG");
}

export function localname(name: string) {
    return skynet_rt.addresscommand("QUERY", name);
}

let starttime_ts = 0;
export function starttime() {
    if (!starttime_ts) {
        starttime_ts = skynet_rt.intcommand("STARTTIME");
    }
    return starttime_ts;
}

export function time() {
	return now() / 100 + (starttime_ts || starttime())
}

export function exit() {
    send(".launcher", "lua", "REMOVE", self(), false);
    // report the sources that call me
    for (let [session, addr] of watching_response) {
        skynet_rt.send(addr, PTYPE_ID.ERROR, session);
    }
    watching_response.clear();
    for (let [resp, _] of unresponse) {
        resp(false);
    }
    unresponse.clear();

    // report the sources I call but haven't return
    let watching_addr = new Set<SERVICE_ADDR>();
    for (let [_, addr] of watching_request) {
        watching_addr.add(addr);
    }
    watching_request.clear();
    watching_addr.forEach((addr) => {
        skynet_rt.send(addr, PTYPE_ID.ERROR, 0);
    });

    skynet_rt.exit();
}

export function get_env(name: string, d: string): string {
    return skynet_rt.get_env(name, d);
}

export function set_env(name: string, value: string) {
    assert(skynet_rt.get_env(name) === undefined, `Can't setenv exist key : ${name}`);
    skynet_rt.set_env(name, value)
}

export function send(addr: SERVICE_ADDR, typename: string, ...params: any[]): number {
    let p = proto.get(typename);
    let pack = p!.pack!(...params);
    return skynet_rt.send(addr, p!.id, 0, pack);
}

export function rawsend(addr: SERVICE_ADDR, typename: string, bytes: Uint8Array): number {
    let p = proto.get(typename);
    return skynet_rt.send(addr, p!.id, 0, bytes);
}

export function genid(): number {
    return skynet_rt.genid()
}

// TODO skynet.redirect

async function _yield_call(session: number, addr: SERVICE_ADDR): Promise<[Uint8Array, number, number]> {
    let promise = new Promise((resolve, reject) => {
        session_id_callback.set(session, [resolve, reject]);
    })

    watching_request.set(session, addr);
    try {
        let rsp = (await promise) as [Uint8Array, number, number];
        return rsp;
    } catch {
        throw new Error("call failed");
    } finally {
        watching_request.delete(session);
        session_id_callback.delete(session);    
    }
}

export async function call(addr: SERVICE_ADDR, typename: string, ...params: any[]) {
    let p = proto.get(typename);
    let pack = p!.pack!(...params);
    let session = skynet_rt.send(addr, p!.id, null, pack);
    let [buff, offset, sz] = await _yield_call(session, addr);

    return p!.unpack!(buff, offset, sz);
}

export function ret(context: CONTEXT, pack?: Uint8Array) {
    if (context.session == 0) {
        // send don't need ret
        return false;
    }

    watching_response.delete(context.session);
    let ret;
    if (pack) {
        ret = skynet_rt.send(context.source, PTYPE_ID.RESPONSE, context.session, pack);
    } else {
        ret = skynet_rt.send(context.source, PTYPE_ID.RESPONSE, context.session);
    }
    
    if (ret) {
        return true;
    } else if (ret === false) {
        skynet_rt.send(context.source, PTYPE_ID.ERROR, context.session);
    }
    return false;
}

export function retpack(context: CONTEXT, ...params: any) {
    let pack = context.proto!.pack!(...params);
    return ret(context, pack);
}

export function response(context: CONTEXT) {
    if (context.session == 0) {
        // do not response when session == 0 (send)
        return (ok: boolean|"TEST", ...params: any) => {}
    }
    assert(watching_response.has(context.session), "no session");
    watching_response.delete(context.session);

    let response = (ok: boolean|"TEST", ...params: any) => {
        if (ok == "TEST") {
            return unresponse.has(response);
        }

        let ret = false;
        if (unresponse.has(response)) {
            if (ok) {
                let pack = context.proto!.pack!(...params);
                ret = skynet_rt.send(context.source, PTYPE_ID.RESPONSE, context.session, pack);
                if (ret == false) {
					// If the package is too large, returns false. so we should report error back
					skynet_rt.send(context.source, PTYPE_ID.ERROR, context.session)
                }
            } else {
                ret = skynet_rt.send(context.source, PTYPE_ID.ERROR, context.session)
            }

            unresponse.delete(response);
        }
        return ret;
    }
    unresponse.set(response, context.source);
    return response;
}

export function register_protocol(p: PROTOCOL_TYPE) {
    let name = p.name;
    let id = p.id;
    assert(!proto.has(name) && !proto.has(id));
	assert(typeof(name) == "string" && typeof(id) == "number" && id >=0 && id <=255);

    proto.set(name, p);
	proto.set(id, p);
}

export function dispatch(name: string, func?: Function) {
    let p = proto.get(name);
    assert(p);
    if (func) {
        let ret = p!.dispatch;
        p!.dispatch = func;
        return ret;
    } else {
        return p && p.dispatch;
    }
}

export async function newservice(name: string, ...params: any[]) {
    let ret = await call(".launcher", PTYPE_NAME.LUA, "LAUNCH", "snjs", name, ...params);
    return ret[0] as number;
}

export function address(addr: SERVICE_ADDR) {
    if (typeof(addr) == "number") {
        return ":" + `00000000${addr.toString(16)}`.slice(-8);
    } else {
        return addr.toString();
    }
}

export function assert<T>(cond: T, msg?: string): T {
    if (!cond) {
        let err = msg ? new Error(`assert failed ${cond} ${msg}`) : new Error(`assert failed ${cond}`);
        throw err;
    }
    return cond;
}

export function string_unpack(msg: Uint8Array, offset: number, sz: number) {
    return [new TextDecoder().decode(msg.subarray(offset, offset+sz))];
}

export function string_pack(msg: string) {
    return [new TextEncoder().encode(msg)];
}

export function error(msg: string) {
    skynet_rt.error(msg);
}

import * as lua_seri from "lua_seri"
register_protocol({
    id: PTYPE_ID.LUA,
    name: PTYPE_NAME.LUA,
    pack: (...obj: any[]): Uint8Array => {
        let bytes = alloc_buffer(SHARED_MIN_SZ, shared_bytes);
        let sz;
        [shared_bytes, sz] = lua_seri.encode_ex(bytes, 0, ...obj);
        return shared_bytes.subarray(0, sz);
    },
    unpack: (msg: Uint8Array, offset: number, sz: number) => {
        return lua_seri.decode_ex(msg, offset, sz);
    },
    dispatch: undefined,
})

register_protocol({
    id: PTYPE_ID.RESPONSE,
    name: PTYPE_NAME.RESPONSE,
})

register_protocol({
    id: PTYPE_ID.ERROR,
    name: PTYPE_NAME.ERROR,
    unpack: (...params: any[]) => { return params; },
    dispatch: function (context: CONTEXT) {
        _error_dispatch(context.session, context.source);
    },
})


let init_func: Array<Function> | undefined = new Array<Function>();
let init_func_name = new Set<string>();
export function init(f: Function, name?: string) {
    assert(typeof(f) == "function")
    if (init_func === undefined) {
        f()
    } else {
        init_func.push(f);
        if (name) {
            assert(typeof(name) == "string");
            assert(!init_func_name.has(name));
            init_func_name.add(name);
        }
    }
}

async function init_all() {
    let funcs = init_func;
    init_func = undefined;
    init_func_name.clear();
    for (let f of (funcs || [])) {
        await f();
    }
}

export function start(start_func: Function) {
    skynet_rt.callback(dispatch_message);
    timeout(0, () => {
        init_service(start_func);
    })
}

async function init_service(start: Function) {
    try {
        await init_all();
        init_func = [];
        await start();
        await init_all();

        send(".launcher", "lua", "LAUNCHOK");
    } catch (e) {
        skynet_rt.error(`init service failed: ${e} ${e.stack}`);
        send(".launcher", "lua", "ERROR");
        exit();
    }
}

export function endless() {
    return skynet_rt.intcommand("STAT", "endless") == 1
}

export function mqlen() {
    return skynet_rt.intcommand("STAT", "mqlen")
}

export function stat(what: string) {
    return skynet_rt.intcommand("STAT", what)
}

export function now(): number {
    return skynet_rt.now();
}

export function term(service: SERVICE_ADDR) {
	return _error_dispatch(0, service)
}

export function launch(...params: (number|string)[]) {
    let ret = skynet_rt.command("LAUNCH", params.join(" "))
	if (ret) {
		return parseInt(ret.slice(1), 16)
    }
}

export function kill(name: SERVICE_ADDR) {
    if (typeof(name) == "number") {
        send(".launcher", PTYPE_NAME.LUA, "REMOVE", name, true)
		name = address(name)
    }
    skynet_rt.command("KILL", name);
}

export function abort() {
    skynet_rt.command("ABORT");
}

function is_globalname(name: string) {
    return name[0] != ".";
}

export function register(name: string) {
    assert(!is_globalname(name));
    skynet_rt.command("REG", name);
}

export function name(name: string, handle: number) {
    assert(!is_globalname(name));
    skynet_rt.command("NAME", `${name} ${address(handle)}`)
}

export function memory_info() {
    return {
        v8: {},
        system: {},
    };
}

export function task() {
    return session_id_callback.size;    
}

import("skynet/debug");