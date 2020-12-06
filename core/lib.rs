extern crate libc;
#[macro_use]
extern crate log;
#[macro_use]
extern crate lazy_static;

use libc::{c_char, c_int, c_uint, c_void, size_t};
use std::ffi::CStr;
use std::mem::drop;
use std::ptr;

mod bindings;
mod cmds;
pub mod error;
mod gotham_state;
mod modules;
pub mod ops;
mod resources;
mod runtime;
mod zero_copy_buf;
mod inspector;

pub use futures;
pub use rusty_v8 as v8;
pub use serde;
pub use serde_json;
pub use url;

pub use crate::ops::json_op_sync;
pub use crate::ops::OpFn;
pub use crate::ops::OpId;
pub use crate::ops::OpState;
pub use crate::ops::OpTable;
pub use crate::resources::ResourceTable;
pub use crate::runtime::GetErrorClassFn;
pub use crate::runtime::HeapLimits;
pub use crate::runtime::JsRuntime;
pub use crate::runtime::JsRuntimeState;
pub use crate::runtime::RuntimeOptions;
pub use crate::runtime::Snapshot;
pub use crate::zero_copy_buf::BufVec;
pub use crate::zero_copy_buf::ZeroCopyBuf;

#[repr(C)]
pub struct skynet_socket_message {
    msg_type: c_int,
    id: c_int,
    ud: c_int,
    buffer: *const u8,
}
pub const SKYNET_SOCKET_MESSAGE_SIZE: u64 = 24;
#[repr(C)]
pub struct socket_sendbuffer {
    id: c_int,
    msg_type: c_int,
    buffer: *const u8,
    sz: size_t,
}

extern "C" {
    pub fn skynet_send(
        skynet: *const c_void,
        source: c_int,
        dest: c_uint,
        stype: c_int,
        session: c_int,
        msg: *const c_void,
        size: usize,
    ) -> c_int;
    pub fn skynet_sendname(
        skynet: *const c_void,
        source: c_int,
        dest: *const c_char,
        stype: c_int,
        session: c_int,
        msg: *const c_void,
        size: usize,
    ) -> c_int;

    pub fn skynet_callback(skynet: *const c_void, ctx: *const c_void, cb: *const c_void);
    pub fn skynet_command(
        skynet: *const c_void,
        cmd: *const c_char,
        parm: *const c_char,
    ) -> *const c_char;
    pub fn skynet_error(skynet: *const c_void, err: *const c_char);
    pub fn skynet_now() -> u64;

    pub fn skynet_socket_connect(skynet: *const c_void, host: *const c_char, port: c_int) -> c_int;
    pub fn skynet_socket_close(skynet: *const c_void, id: c_int) -> c_void;
    pub fn skynet_socket_shutdown(skynet: *const c_void, id: c_int) -> c_void;
    pub fn skynet_socket_udp_address(message: *mut skynet_socket_message, addrsz: *mut c_int) -> *const c_char;
    pub fn skynet_socket_bind(skynet: *const c_void, fd: c_int) -> c_int;
    pub fn skynet_socket_start(skynet: *const c_void, id: c_int) -> c_void;
    pub fn skynet_socket_listen(skynet: *const c_void, host: *const c_char, port: c_int, backlog: c_int) -> c_int;
    pub fn skynet_socket_udp(skynet: *const c_void, host: *const c_char, port: c_int) -> c_int;
    pub fn skynet_socket_udp_connect(skynet: *const c_void, id: c_int, host: *const c_char, port: c_int) -> c_void;
    pub fn skynet_socket_sendbuffer(skynet: *const c_void, buffer: *mut socket_sendbuffer) -> c_int;
    pub fn skynet_socket_sendbuffer_lowpriority(skynet: *const c_void, buffer: *mut socket_sendbuffer) -> c_int;
    pub fn skynet_socket_udp_sendbuffer(skynet: *const c_void, address: *const c_char, buffer: *mut socket_sendbuffer) -> c_int;
}
pub const PTYPE_TAG_DONTCOPY: c_int = 0x10000;
pub const PTYPE_TAG_ALLOCSESSION: c_int = 0x20000;

pub const SKYNET_SOCKET_TYPE_DATA: c_int = 1;
pub const SKYNET_SOCKET_TYPE_CONNECT: c_int = 2;
pub const SKYNET_SOCKET_TYPE_CLOSE: c_int = 3;
pub const SKYNET_SOCKET_TYPE_ACCEPT: c_int = 4;
pub const SKYNET_SOCKET_TYPE_ERROR: c_int = 5;
pub const SKYNET_SOCKET_TYPE_UDP: c_int = 6;
pub const SKYNET_SOCKET_TYPE_WARNING: c_int = 7;

#[repr(C)]
pub struct snjs {
    skynet: *const c_void,
    isolate: Box<JsRuntime>,
}

#[no_mangle]
pub extern "C" fn snjs_create() -> *mut snjs {
    static CLI_SNAPSHOT: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/CLI_SNAPSHOT.bin"));

    let isolate = JsRuntime::new(RuntimeOptions {
        startup_snapshot: Some(Snapshot::Static(CLI_SNAPSHOT)),
        ..Default::default()
    });

    let ctx = Box::new(snjs {
        skynet: ptr::null(),
        isolate: isolate,
    });

    Box::into_raw(ctx)
}

#[no_mangle]
pub extern "C" fn snjs_release(ctx: *mut snjs) {
    let ctx = unsafe { Box::from_raw(ctx) };
    drop(ctx);
}

#[no_mangle]
pub extern "C" fn snjs_signal(_ctx: *mut snjs, _signal: c_int) {}

fn get_env(ctx: *const c_void, name: &str, default: &str) -> String {
    unsafe {
        let cmd = std::ffi::CString::new("GETENV").unwrap();
        let name = std::ffi::CString::new(name).unwrap();
        let result = skynet_command(ctx, cmd.as_ptr(), name.as_ptr());
        if result == ptr::null() {
            String::from(default)
        } else {
            String::from(CStr::from_ptr(result).to_str().unwrap())
        }
    }
}

#[no_mangle]
pub extern "C" fn dispatch_cb(
    skynet: *const c_void,
    ctx: *mut snjs,
    stype: c_int,
    session: c_int,
    source: c_int,
    msg: *const c_void,
    sz: size_t,
) -> c_int {
    let ctx = unsafe { &mut *ctx };

    let _locker = v8::Locker::new(ctx.isolate.v8_isolate());
    let _isolate_scope = v8::IsolateScope::new(ctx.isolate.v8_isolate());
    let _auto_check = runtime::IsolateAutoCheck::new(ctx.isolate.v8_isolate());

    let r = ctx
        .isolate
        .dispatch(stype, session, source, msg as *const u8, sz);
    if let Err(err) = r {
        let err = std::ffi::CString::new(format!("{:?}", err)).unwrap();
        unsafe { skynet_error(skynet, err.as_ptr()) };
    }

    0
}

#[no_mangle]
pub extern "C" fn init_cb(
    skynet: *const c_void,
    ctx: *mut snjs,
    _stype: c_int,
    _session: c_int,
    _source: c_int,
    msg: *const c_void,
    _sz: size_t,
) -> c_int {
    let ctx = unsafe { &mut *ctx };
    unsafe { skynet_callback(ctx.skynet, ptr::null_mut(), ptr::null_mut()) };

    let args = unsafe { CStr::from_ptr(msg as *const c_char) }
        .to_str()
        .unwrap();
    let loader_path = get_env(ctx.skynet, "js_loader", "./js/loader.js");
    let _locker = v8::Locker::new(ctx.isolate.v8_isolate());
    let _isolate_scope = v8::IsolateScope::new(ctx.isolate.v8_isolate());
    let _auto_check = runtime::IsolateAutoCheck::new(ctx.isolate.v8_isolate());

    {
        let op_state = ctx.isolate.op_state();
        let mut op_state = op_state.borrow_mut();
        op_state.skynet = skynet;
    }

    cmds::os::init(&mut ctx.isolate);
    cmds::errors::init(&mut ctx.isolate);
    cmds::random::init(&mut ctx.isolate, None);
    cmds::skynet::init(&mut ctx.isolate);
    cmds::inspect::init(&mut ctx.isolate);

    let inspector = get_env(ctx.skynet, "js_inspector", "false");
    if inspector == "true" {
        let context = ctx.isolate.global_context();

        let state_rc = JsRuntime::state(ctx.isolate.v8_isolate());
        let mut state = state_rc.borrow_mut();

        let scope = &mut v8::HandleScope::with_context(ctx.isolate.v8_isolate(), context);
        state.create_inspector(scope);
    }

    ctx.isolate
        .execute("core.js", include_str!("core.js"))
        .unwrap();
    ctx.isolate
        .execute("init", "bootstrap.mainRuntime()")
        .unwrap();
    ctx.isolate
        .execute("init", format!("JS_INIT_ARGS='{}'", args).as_str())
        .unwrap();
    let r = ctx.isolate.load_module(loader_path.as_str());
    if let Err(err) = r {
        unsafe {
            skynet_error(
                skynet,
                std::ffi::CString::new(format!("can not loader {:?} err:{:?}", loader_path, err))
                    .unwrap()
                    .as_ptr(),
            )
        };

        let cmd = std::ffi::CString::new("EXIT").unwrap();
        unsafe {
            skynet_command(skynet, cmd.as_ptr(), ptr::null());
        };
        return 0;
    }

    unsafe { skynet_callback(ctx.skynet, ctx as *mut snjs as *const c_void, dispatch_cb as *const c_void) };
    0
}

#[no_mangle]
pub extern "C" fn snjs_init(ptr: *mut snjs, skynet: *const c_void, args: *const c_char) -> c_int {
    let ctx = unsafe { &mut *ptr };
    ctx.skynet = skynet;
    unsafe { skynet_callback(skynet, ctx as *mut snjs as *const c_void, init_cb as *const c_void) };

    let (init_msg, init_sz) = unsafe {
        let sz = libc::strlen(args) + 1;
        let msg = libc::malloc(sz); // skynet_malloc(sz);
        libc::memcpy(msg, args as *const c_void, sz);
        (msg, sz)
    };
    let handle_id = unsafe {
        let cmd = std::ffi::CString::new("REG").unwrap();
        let self_handle = skynet_command(ctx.skynet, cmd.as_ptr(), ptr::null());
        let mut endp: *mut c_char = ptr::null_mut();
        libc::strtoul(self_handle.add(1), &mut endp as *mut _, 16) as u32
        //i64::from_str_radix(CStr::from_ptr(self_handle.add(1)).to_str().unwrap(), 16).unwrap()
    };
    // it must be first message
    unsafe {
        skynet_send(
            ctx.skynet,
            0,
            handle_id,
            PTYPE_TAG_DONTCOPY,
            0,
            init_msg,
            init_sz,
        );
    }

    0
}
