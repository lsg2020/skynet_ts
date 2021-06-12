extern crate libc;

use libc::{c_char, c_int, c_void, size_t};
use std::ffi::CStr;
use std::mem::drop;
use std::ptr;
//use std::sync::atomic::{AtomicBool, Ordering};
//use std::sync::Arc;

use deno_runtime::ops;
use rusty_v8 as v8;

mod interface;
mod loader;
mod mod_skynet;
pub use mod_skynet::get_backing_store_slice_mut;
pub use mod_skynet::BufVec;
mod mod_inspector;
mod mod_tls;

#[repr(C)]
pub struct snjs<'a> {
    skynet: *const c_void,
    tokio_rt: *mut tokio::runtime::Runtime,
    runtime: Box<deno_core::JsRuntime>,
    custom_archive: *mut c_void,
    inspector_session_len: usize,
    waker: *mut std::task::Waker,
    waker_context: *mut std::task::Context<'a>,
    context: SkynetContext,

    locker: *mut v8::Locker,
    tokio_guard: *mut tokio::runtime::EnterGuard<'a>,
}

pub struct ContextData {
    skynet: *const libc::c_void,
    ctx: *const libc::c_void,
    bs: Option<v8::SharedRef<v8::BackingStore>>,
    cb: Option<v8::Global<v8::Function>>,
    module_search_paths: Vec<String>,
    inspector: Option<Box<mod_inspector::Inspector>>,
}
pub type SkynetContext = *mut ContextData;

static mut TOKIO_RT: *mut tokio::runtime::Runtime = ptr::null_mut();
#[no_mangle]
pub extern "C" fn snjs_create() -> *mut snjs<'static> {
    static TOKIO_INIT: std::sync::Once = std::sync::Once::new();
    TOKIO_INIT.call_once(|| {
        let rt = Box::new(
            tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .worker_threads(4)
                .thread_name("tokio-pool")
                .build()
                .unwrap(),
        );
        unsafe { TOKIO_RT = Box::into_raw(rt) };
    });

    let plugin_js = vec![
        ("skynet_ts:01_skynet.js", include_str!("01_skynet.js")),
        ("skynet_ts:01_tls.js", include_str!("01_tls.js")),
        ("skynet_ts:01_inspector.js", include_str!("01_inspector.js")),
    ];

    let perm_ext = deno_core::Extension::builder()
        .state(move |state| {
            state.put(deno_runtime::permissions::Permissions::allow_all());
            state.put(deno_runtime::ops::UnstableChecker { unstable: true });
            Ok(())
        })
        .build();
    // Internal modules
    let extensions: Vec<deno_core::Extension> = vec![
        // Web APIs
        deno_runtime::deno_webidl::init(),
        deno_runtime::deno_console::init(),
        deno_runtime::deno_url::init(),
        deno_runtime::deno_web::init(deno_runtime::deno_web::BlobUrlStore::default(), None),
        deno_runtime::deno_fetch::init::<deno_runtime::permissions::Permissions>(
            "".to_string(),
            None,
        ),
        deno_runtime::deno_websocket::init::<deno_runtime::permissions::Permissions>(
            "".to_string(),
            None,
        ),
        //deno_runtime::deno_webstorage::init(options.location_data_dir.clone()),
        deno_runtime::deno_crypto::init(None),
        deno_runtime::deno_webgpu::init(true),
        deno_runtime::deno_timers::init::<deno_runtime::permissions::Permissions>(),
        // Metrics
        deno_runtime::metrics::init(),
        // Runtime ops
        ops::runtime::init(deno_core::ModuleSpecifier::parse("file:///mainmodule").unwrap()),
        //ops::worker_host::init(options.create_web_worker_cb.clone()),
        ops::fs_events::init(),
        ops::fs::init(),
        ops::http::init(),
        ops::io::init(),
        ops::io::init_stdio(),
        ops::net::init(),
        ops::os::init(),
        ops::permissions::init(),
        ops::plugin::init(),
        ops::process::init(),
        ops::signal::init(),
        ops::tls::init(),
        ops::tty::init(),
        mod_skynet::init(),
        mod_tls::init(),
        mod_inspector::init(),
        // Permissions ext (worker specific state)
        perm_ext,
    ];

    let mut runtime = Box::new(deno_core::JsRuntime::new(deno_core::RuntimeOptions {
        extensions: extensions,
        startup_snapshot: Some(deno_runtime::js::deno_isolate_init()),
        module_loader: Some(std::rc::Rc::new(loader::ModuleLoader::default())),
        ..Default::default()
    }));
    {
        let _isolate_scope = v8::IsolateScope::new(&mut runtime.v8_isolate());
        let _locker = v8::Locker::new(&mut runtime.v8_isolate(), std::ptr::null_mut());
        let _auto_check = deno_core::IsolateAutoCheck::new(&mut runtime.v8_isolate());

        for (filename, source) in plugin_js {
            let _r = runtime.execute(filename, source);
        }
    }

    let custom_archive = unsafe {
        let p = libc::malloc(1024);
        libc::memset(p, 0, 1024);
        p
    };

    let ctx = Box::new(snjs {
        skynet: ptr::null(),
        runtime: runtime,
        locker: ptr::null_mut(),
        tokio_rt: unsafe { TOKIO_RT },
        tokio_guard: ptr::null_mut(),
        custom_archive: custom_archive,
        inspector_session_len: 0,
        waker: ptr::null_mut(),
        waker_context: ptr::null_mut(),
        context: ptr::null_mut(),
    });

    Box::into_raw(ctx)
}

#[no_mangle]
pub extern "C" fn snjs_release(ctx: *mut snjs<'static>) {
    let ctx = unsafe { Box::from_raw(ctx) };

    unsafe { libc::free(ctx.custom_archive) };
    if ctx.waker != ptr::null_mut() {
        unsafe { Box::from_raw(ctx.waker) };
    }
    if ctx.waker_context != ptr::null_mut() {
        unsafe { Box::from_raw(ctx.waker_context) };
    }
    if ctx.locker != ptr::null_mut() {
        unsafe { Box::from_raw(ctx.locker) };
    }
    if ctx.tokio_guard != ptr::null_mut() {
        unsafe {
            let _r = Box::from_raw(ctx.tokio_guard);
        };
    }
    if ctx.context != ptr::null_mut() {
        unsafe {
            Box::from_raw(ctx.context);
        };
    }

    drop(ctx);
}

#[no_mangle]
pub extern "C" fn snjs_signal(_ctx: *mut snjs, _signal: c_int) {}

fn get_env(ctx: *const c_void, name: &str, default: &str) -> String {
    unsafe {
        let cmd = std::ffi::CString::new("GETENV").unwrap();
        let name = std::ffi::CString::new(name).unwrap();
        let result = interface::skynet_command(ctx, cmd.as_ptr(), name.as_ptr());
        if result == ptr::null() {
            String::from(default)
        } else {
            String::from(CStr::from_ptr(result).to_str().unwrap())
        }
    }
}

#[no_mangle]
pub extern "C" fn dispatch_th_cb(
    _skynet: *const c_void,
    ctx: *mut snjs,
    stype: c_int,
    _n: c_int,
) -> c_int {
    //println!("======= dispatch_th_cb {} {}", stype, n);
    let ctx = unsafe { &mut *ctx };

    if stype == 0 {
        unsafe { ctx.runtime.v8_isolate().enter() };
        ctx.locker = Box::into_raw(Box::new(v8::Locker::new(
            ctx.runtime.v8_isolate(),
            if ctx.inspector_session_len > 0 {
                ctx.custom_archive
            } else {
                std::ptr::null_mut()
            },
        )));

        let rt = unsafe { &mut *ctx.tokio_rt };
        ctx.tokio_guard = Box::into_raw(Box::new(rt.enter()));
    } else {
        unsafe {
            let _r = Box::from_raw(ctx.tokio_guard);
            ctx.tokio_guard = ptr::null_mut();
        };
        v8::HandleScope::new(ctx.runtime.v8_isolate());
        unsafe {
            Box::from_raw(ctx.locker);
            ctx.locker = ptr::null_mut();
        };
        unsafe { ctx.runtime.v8_isolate().exit() };
    }

    0
}

#[no_mangle]
pub extern "C" fn dispatch_cb(
    _skynet: *const c_void,
    ctx: *mut snjs,
    stype: c_int,
    session: c_int,
    source: c_int,
    msg: *const c_void,
    sz: size_t,
) -> c_int {
    let ctx = unsafe { &mut *ctx };
    // println!("======= dispatch_cb {} {}", stype, sz);

    if stype & 0x40000 == 0 {
        let _isolate_scope = v8::IsolateScope::new(ctx.runtime.v8_isolate());
        let _locker = v8::Locker::new(ctx.runtime.v8_isolate(), ctx.custom_archive);
        let _auto_check = deno_core::IsolateAutoCheck::new(ctx.runtime.v8_isolate());
        let rt = unsafe { &mut *ctx.tokio_rt };
        let _rt_guard = rt.enter();

        let raw_type = stype & 0xffff;
        if raw_type == interface::PTYPE_DENO_ASYNC {
            let _r = ctx
                .runtime
                .poll_event_loop(unsafe { &mut *ctx.waker_context }, false);
        } else {
            mod_skynet::dispatch(ctx, raw_type, session, source, msg as *const u8, sz);
        }
    } else {
        let raw_type = stype & 0xffff;
        if raw_type == interface::PTYPE_DENO_ASYNC {
            let _r = ctx
                .runtime
                .poll_event_loop(unsafe { &mut *ctx.waker_context }, false);
        } else {
            mod_skynet::dispatch(ctx, raw_type, session, source, msg as *const u8, sz);
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn init_cb(
    skynet: *const c_void,
    ctx_ptr: *mut snjs,
    _stype: c_int,
    _session: c_int,
    _source: c_int,
    msg: *const c_void,
    _sz: size_t,
) -> c_int {
    let ctx = unsafe { &mut *ctx_ptr };
    unsafe { interface::skynet_callback(ctx.skynet, ptr::null_mut(), ptr::null_mut()) };

    let args = unsafe { CStr::from_ptr(msg as *const c_char) }
        .to_str()
        .unwrap();
    let loader_path = get_env(ctx.skynet, "js_loader", "./js/lib/loader.js");

    let _isolate_scope = v8::IsolateScope::new(ctx.runtime.v8_isolate());
    let _locker = v8::Locker::new(ctx.runtime.v8_isolate(), ctx.custom_archive);
    let _auto_check = deno_core::IsolateAutoCheck::new(ctx.runtime.v8_isolate());
    let rt = unsafe { &mut *ctx.tokio_rt };
    let _rt_guard = rt.enter();

    {
        let runtime_options = deno_core::serde_json::json!({
            "args": args,
            "applySourceMaps": false,
            "debugFlag": true,
            "denoVersion": "",
            "noColor": false,
            "pid": std::process::id(),
            "ppid": deno_runtime::ops::runtime::ppid(),
            "target": deno_runtime::js::TARGET,
            "tsVersion": "",
            "unstableFlag": true,
            "v8Version": deno_core::v8_version(),
            "location": null,
        });

        let script = format!(
            "bootstrap.mainRuntime({})",
            serde_json::to_string_pretty(&runtime_options).unwrap()
        );
        let _r = ctx.runtime.execute("", &script);

        let inspector = if get_env(ctx.skynet, "js_inspector", "false") == "true" {
            let global = ctx.runtime.global_context();
            Some(mod_inspector::Inspector::new(
                &mut ctx.runtime.handle_scope(),
                global,
            ))
        } else {
            None
        };

        let data = Box::into_raw(Box::new(ContextData {
            skynet: ctx.skynet,
            ctx: ctx_ptr as *const libc::c_void,
            bs: None,
            cb: None,
            module_search_paths: Vec::new(),
            inspector: inspector,
        }));
        ctx.runtime
            .op_state()
            .borrow_mut()
            .put::<SkynetContext>(data);
        ctx.context = data;
    }

    // register JsRuntimeState.waker
    let _r = ctx
        .runtime
        .poll_event_loop(unsafe { &mut *ctx.waker_context }, false);
    let base_path = url::Url::from_file_path(std::env::current_dir().unwrap())
        .unwrap()
        .to_string()
        + "/js_loader.js";
    let loader_script = String::from("")
        + r#"
"use strict";
(async (window) => {
    let loader_path = '"#
        + &loader_path
        + r#"';
    try {
        await import(loader_path);
    } catch (e) {
        Skynet.error(`can not loader ${loader_path} err: ${e} ${e.stack}`);
        Skynet.exit();
    }
})(this);
    "#;
    let _r = ctx
        .runtime
        .execute(&base_path, &format!("JS_INIT_ARGS='{}'", args));

    let r = ctx.runtime.execute(&base_path, &loader_script);
    if let Err(err) = r {
        let err_msg =
            std::ffi::CString::new(format!("can not loader {:?} err:{:?}", loader_path, err))
                .unwrap();
        unsafe { interface::skynet_error(skynet, err_msg.as_ptr()) };

        let cmd = std::ffi::CString::new("EXIT").unwrap();
        unsafe { interface::skynet_command(skynet, cmd.as_ptr(), ptr::null()) };
        return 0;
    }

    unsafe {
        interface::skynet_callback(
            ctx.skynet,
            ctx as *mut snjs as *const c_void,
            dispatch_cb as *const c_void,
        )
    };

    0
}

#[no_mangle]
pub extern "C" fn snjs_init(ptr: *mut snjs, skynet: *const c_void, args: *const c_char) -> c_int {
    let ctx = unsafe { &mut *ptr };
    ctx.skynet = skynet;
    unsafe {
        interface::skynet_callback(
            skynet,
            ctx as *mut snjs as *const c_void,
            init_cb as *const c_void,
        )
    };

    let (init_msg, init_sz) = unsafe {
        let sz = libc::strlen(args) + 1;
        //let msg = libc::malloc(sz);
        let msg = interface::skynet_malloc(sz as u32);
        libc::memcpy(msg, args as *const c_void, sz);
        (msg, sz)
    };
    let handle_id = unsafe {
        let cmd = std::ffi::CString::new("REG").unwrap();
        let self_handle = interface::skynet_command(ctx.skynet, cmd.as_ptr(), ptr::null());
        let mut endp: *mut c_char = ptr::null_mut();
        libc::strtoul(self_handle.add(1), &mut endp as *mut _, 16) as u32
    };

    struct SharedWaker(*const c_void);
    unsafe impl Send for SharedWaker {}
    unsafe impl Sync for SharedWaker {}
    let shared = SharedWaker(skynet.clone());
    let waker = Box::new(async_task::waker_fn(move || {
        // println!("-=============== waker {:?}", shared.0);
        unsafe {
            interface::skynet_send(
                shared.0,
                0,
                handle_id,
                interface::PTYPE_TAG_DONTCOPY | interface::PTYPE_DENO_ASYNC,
                0,
                ptr::null(),
                0,
            );
        }
    }));
    ctx.waker = Box::into_raw(waker);
    let waker = unsafe { &mut *ctx.waker };
    ctx.waker_context = Box::into_raw(Box::new(std::task::Context::from_waker(waker)));

    // it must be first message
    unsafe {
        interface::skynet_send(
            ctx.skynet,
            0,
            handle_id,
            interface::PTYPE_TAG_DONTCOPY,
            0,
            init_msg,
            init_sz,
        );
    };
    unsafe {
        interface::skynet_thread_notify_callback(
            ctx.skynet,
            ctx as *mut snjs as *const c_void,
            dispatch_th_cb as *const c_void,
        )
    };

    0
}
