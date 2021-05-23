use byteorder::{ByteOrder, LittleEndian};
use libc::{c_int, size_t};
use std::cell::Cell;
use std::cell::RefCell;
use std::convert::TryFrom;
use std::rc::Rc;
use std::string::String;

use deno_core::include_js_files;
use deno_core::op_sync;
use deno_core::serde::Deserialize;
use deno_core::Extension;
use deno_core::OpState;
use deno_core::ZeroCopyBuf;
// use deno_core::serde::Serialize;
use deno_core::error::AnyError;
use deno_core::get_args;

use rusty_v8 as v8;

use crate::interface;
use crate::SkynetContext;

pub fn init() -> Extension {
    Extension::builder()
        .js(include_js_files!(
          prefix "deno:extensions/skynet",
          "01_skynet.js",
        ))
        .ops(vec![
            ("op_skynet_command", op_sync(op_skynet_command)),
            ("op_skynet_error", op_sync(op_skynet_error)),
            ("op_skynet_send", op_sync(op_skynet_send)),
            ("op_skynet_send_name", op_sync(op_skynet_send_name)),
            ("op_skynet_now", op_sync(op_skynet_now)),
            ("op_skynet_genid", op_sync(op_skynet_genid)),
            (
                "op_skynet_socket_connect",
                op_sync(op_skynet_socket_connect),
            ),
            ("op_skynet_socket_close", op_sync(op_skynet_socket_close)),
            (
                "op_skynet_socket_shutdown",
                op_sync(op_skynet_socket_shutdown),
            ),
            ("op_skynet_socket_bind", op_sync(op_skynet_socket_bind)),
            ("op_skynet_socket_start", op_sync(op_skynet_socket_start)),
            ("op_skynet_socket_listen", op_sync(op_skynet_socket_listen)),
            ("op_skynet_socket_udp", op_sync(op_skynet_socket_udp)),
            (
                "op_skynet_socket_udp_connect",
                op_sync(op_skynet_socket_udp_connect),
            ),
            (
                "op_skynet_socket_nodelay",
                op_sync(op_skynet_socket_nodelay),
            ),
            ("op_skynet_set_jslib_paths", op_sync(op_skynet_set_jslib_paths)),
        ])
        .ops_ex(vec![
            ("op_skynet_fetch_message", Box::new(op_skynet_fetch_message)),
            ("op_skynet_free", Box::new(op_skynet_free)),
            ("op_skynet_shared_bs", Box::new(op_skynet_shared_bs)),
            ("op_skynet_callback", Box::new(op_skynet_callback)),
            ("op_skynet_socket_unpack", Box::new(op_skynet_socket_unpack)),
            (
                "op_skynet_socket_alloc_msg",
                Box::new(op_skynet_socket_alloc_msg),
            ),
            ("op_skynet_socket_send", Box::new(op_skynet_socket_send)),
            (
                "op_skynet_socket_send_lowpriority",
                Box::new(op_skynet_socket_send_lowpriority),
            ),
            ("op_skynet_socket_sendto", Box::new(op_skynet_socket_sendto)),
        ])
        .build()
}

fn throw_type_error<'s>(scope: &mut v8::HandleScope<'s>, message: impl AsRef<str>) {
    let message = v8::String::new(scope, message.as_ref()).unwrap();
    let exception = v8::Exception::type_error(scope, message);
    scope.throw_exception(exception);
}

pub fn dispatch(
    ctx: &mut crate::snjs,
    stype: c_int,
    session: c_int,
    source: c_int,
    msg: *const u8,
    sz: size_t,
) {
    /*
    let state_rc = deno_core::JsRuntime::state(ctx.runtime.v8_isolate());
    let state = state_rc.borrow_mut();
    let scope = &mut v8::HandleScope::new(ctx.runtime.v8_isolate());
    let context = state
        .global_context
        .as_ref()
        .map(|context| v8::Local::new(scope, context))
        .unwrap();
    let scope = &mut v8::ContextScope::new(scope, context);
    */
    let scope = &mut ctx.runtime.handle_scope();
    let tc_scope = &mut v8::TryCatch::new(scope);

    let skynet = unsafe { &mut *ctx.context };

    let offset: usize = 64;
    let new_bs = get_shared_bs(skynet, tc_scope, sz + offset);
    let buf = unsafe {
        let bs = skynet.bs.as_ref().unwrap();
        get_backing_store_slice_mut(bs, 0, bs.byte_length())
    };

    let mut index = 0;
    LittleEndian::write_i32(&mut buf[index..index + 4], stype);
    index = index + 4;
    LittleEndian::write_i32(&mut buf[index..index + 4], session);
    index = index + 4;
    LittleEndian::write_i32(&mut buf[index..index + 4], source);
    index = index + 4;
    LittleEndian::write_u32(&mut buf[index..index + 4], sz as u32);
    index = index + 4;
    LittleEndian::write_u64(&mut buf[index..index + 8], msg as u64);
    if sz > 0 {
        buf[offset..offset + sz].copy_from_slice(unsafe { std::slice::from_raw_parts(msg, sz) });
    }

    let v8_new_bs = v8::Boolean::new(tc_scope, new_bs).into();

    /*
    let global = context.global(tc_scope).into();
    let js_recv_cb = skynet
        .cb
        .as_ref()
        .map(|cb| v8::Local::new(tc_scope, cb))
        .unwrap();
    drop(state);
    js_recv_cb.call(tc_scope, global, &[v8_new_bs]);
    */
    let js_recv_cb_handle = skynet.cb.clone().unwrap();
    let this = v8::undefined(tc_scope).into();
    let js_recv_cb = js_recv_cb_handle.get(tc_scope);
    js_recv_cb.call(tc_scope, this, &[v8_new_bs]);
}

pub fn op_skynet_callback(
    _state: &mut deno_core::JsRuntimeState,
    op_state: Rc<RefCell<OpState>>,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _rv: &mut v8::ReturnValue,
) {
    let cb = match v8::Local::<v8::Function>::try_from(args.get(1)) {
        Ok(cb) => cb,
        Err(err) => return throw_type_error(scope, err.to_string()),
    };

    let mut op_state_rc = op_state.borrow_mut();
    let skynet = op_state_rc.borrow_mut::<SkynetContext>();
    let skynet = unsafe { &mut **skynet };

    skynet.cb.replace(v8::Global::new(scope, cb));
}

pub fn op_skynet_shared_bs(
    _state: &mut deno_core::JsRuntimeState,
    op_state: Rc<RefCell<OpState>>,
    scope: &mut v8::HandleScope,
    _args: v8::FunctionCallbackArguments,
    rv: &mut v8::ReturnValue,
) {
    let mut op_state_rc = op_state.borrow_mut();
    let skynet = op_state_rc.borrow_mut::<SkynetContext>();
    let skynet = unsafe { &mut **skynet };

    let shared_ab = {
        let ab = v8::SharedArrayBuffer::with_backing_store(scope, skynet.bs.as_mut().unwrap());
        ab
    };
    rv.set(shared_ab.into())
}

pub fn op_skynet_set_jslib_paths(
    state: &mut OpState,
    paths: String,
    _: (),
) -> Result<(), AnyError> {
    let skynet = state.borrow_mut::<SkynetContext>();
    let skynet = unsafe { &mut **skynet };

    skynet.module_search_paths = paths.split(";").map(|p| p.to_owned()).collect();
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandArgs {
    cmd: String,
    param: String,
}
pub fn op_skynet_command(
    state: &mut OpState,
    args: CommandArgs,
    _zero_copy: Option<ZeroCopyBuf>,
) -> Result<Option<String>, AnyError> {
    let skynet = state.borrow_mut::<SkynetContext>();
    let skynet = unsafe { &mut **skynet };

    let cmd = std::ffi::CString::new(args.cmd).unwrap();
    let param = std::ffi::CString::new(args.param).unwrap();

    let result = unsafe { interface::skynet_command(skynet.skynet, cmd.as_ptr(), param.as_ptr()) };
    if result != std::ptr::null() {
        Ok(Some(unsafe {
            std::ffi::CStr::from_ptr(result)
                .to_str()
                .unwrap()
                .to_string()
        }))
    } else {
        Ok(None)
    }
}

pub fn op_skynet_error(state: &mut OpState, err: String, _: ()) -> Result<u32, AnyError> {
    let skynet = state.borrow_mut::<SkynetContext>();
    let skynet = unsafe { &mut **skynet };

    let err = std::ffi::CString::new(err).unwrap();

    let error = std::ffi::CString::new(err).unwrap();
    unsafe { interface::skynet_error(skynet.skynet, error.as_ptr()) };

    Ok(1)
}

fn merge_bufs(zero_copy: &[ZeroCopyBuf]) -> (*const libc::c_void, libc::size_t) {
    let mut sz = 0;
    for buf in zero_copy {
        sz += (buf as &[u8]).len();
    }

    let dest = unsafe { libc::malloc(sz) };
    sz = 0;
    for buf in zero_copy {
        let buf_sz = (buf as &[u8]).len();
        unsafe {
            libc::memcpy(dest.add(sz), buf.as_ptr() as *const libc::c_void, buf_sz);
        }
        sz += buf_sz;
    }
    return (dest, sz);
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendArgs {
    dest: u32,
    ptype: i32,
    session: i32,
}
pub fn op_skynet_send(
    state: &mut OpState,
    args: SendArgs,
    bufs: Vec<ZeroCopyBuf>,
) -> Result<i32, AnyError> {
    let skynet = state.borrow_mut::<SkynetContext>();
    let skynet = unsafe { &mut **skynet };

    let (msg_buf, msg_sz) = merge_bufs(&bufs);

    let session = unsafe {
        interface::skynet_send(
            skynet.skynet,
            0,
            args.dest,
            args.ptype | interface::PTYPE_TAG_DONTCOPY,
            args.session,
            msg_buf,
            msg_sz,
        )
    };
    Ok(session)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendNameArgs {
    name: String,
    ptype: i32,
    session: i32,
}
pub fn op_skynet_send_name(
    state: &mut OpState,
    args: SendNameArgs,
    bufs: Vec<ZeroCopyBuf>,
) -> Result<i32, AnyError> {
    let skynet = state.borrow_mut::<SkynetContext>();
    let skynet = unsafe { &mut **skynet };

    let name = std::ffi::CString::new(args.name).unwrap();
    let (msg_buf, msg_sz) = merge_bufs(&bufs);

    let session = unsafe {
        interface::skynet_sendname(
            skynet.skynet,
            0,
            name.as_ptr(),
            args.ptype | interface::PTYPE_TAG_DONTCOPY,
            args.session,
            msg_buf,
            msg_sz,
        )
    };
    Ok(session)
}

pub fn op_skynet_now(_state: &mut OpState, _args: (), _: ()) -> Result<u64, AnyError> {
    let now = unsafe { interface::skynet_now() };
    Ok(now)
}

pub fn op_skynet_genid(state: &mut OpState, _args: (), _: ()) -> Result<i32, AnyError> {
    let skynet = state.borrow_mut::<SkynetContext>();
    let skynet = unsafe { &mut **skynet };

    let session = unsafe {
        interface::skynet_send(
            skynet.skynet,
            0,
            0,
            interface::PTYPE_TAG_ALLOCSESSION,
            0,
            std::ptr::null(),
            0,
        )
    };

    Ok(session)
}

pub fn op_skynet_free(
    _state: &mut deno_core::JsRuntimeState,
    _op_state: Rc<RefCell<OpState>>,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _rv: &mut v8::ReturnValue,
) {
    let msg = get_args!(scope, v8::BigInt, args, 1).u64_value().0;
    unsafe { libc::free(msg as *mut libc::c_void) };
}

#[allow(clippy::mut_from_ref)]
pub unsafe fn get_backing_store_slice_mut(
    backing_store: &v8::SharedRef<v8::BackingStore>,
    byte_offset: usize,
    byte_length: usize,
) -> &mut [u8] {
    let cells: *const [Cell<u8>] = &backing_store[byte_offset..byte_offset + byte_length];
    let bytes = cells as *const _ as *mut [u8];
    &mut *bytes
}

pub fn op_skynet_fetch_message(
    _state: &mut deno_core::JsRuntimeState,
    _op_state: Rc<RefCell<OpState>>,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    rv: &mut v8::ReturnValue,
) {
    let msg = get_args!(scope, v8::BigInt, args, 1).u64_value().0;
    let sz = get_args!(scope, v8::Integer, args, 2).value() as libc::size_t;
    let buffer = get_args!(scope, v8::ArrayBuffer, args, 3);
    let buffer = v8::ArrayBuffer::get_backing_store(&buffer);
    let offset = get_args!(scope, v8::Integer, args, 4).value() as libc::size_t;

    if sz > 0 {
        let buf = unsafe { get_backing_store_slice_mut(&buffer, offset, sz + offset) };
        buf.copy_from_slice(unsafe { std::slice::from_raw_parts(msg as *const u8, sz) });
    }

    let v8_sz = v8::Integer::new(scope, sz as i32).into();
    rv.set(v8_sz);
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocketConnectArgs {
    addr: String,
    port: i32,
}
pub fn op_skynet_socket_connect(
    state: &mut OpState,
    args: SocketConnectArgs,
    _: (),
) -> Result<i32, AnyError> {
    let skynet = state.borrow_mut::<SkynetContext>();
    let skynet = unsafe { &mut **skynet };

    let addr = std::ffi::CString::new(args.addr)?;

    let id = unsafe { interface::skynet_socket_connect(skynet.skynet, addr.as_ptr(), args.port) };

    Ok(id)
}

pub fn op_skynet_socket_close(state: &mut OpState, socket_id: i32, _: ()) -> Result<(), AnyError> {
    let skynet = state.borrow_mut::<SkynetContext>();
    let skynet = unsafe { &mut **skynet };

    unsafe {
        interface::skynet_socket_close(skynet.skynet, socket_id);
    };
    Ok(())
}

pub fn op_skynet_socket_shutdown(
    state: &mut OpState,
    socket_id: i32,
    _: (),
) -> Result<(), AnyError> {
    let skynet = state.borrow_mut::<SkynetContext>();
    let skynet = unsafe { &mut **skynet };

    unsafe {
        interface::skynet_socket_shutdown(skynet.skynet, socket_id);
    };
    Ok(())
}

const SHARED_MIN_SZ: usize = 128;
const SHARED_MAX_SZ: usize = 64 * 1024;
pub fn get_shared_bs(
    skynet: &mut crate::ContextData,
    scope: &mut v8::HandleScope,
    sz: usize,
) -> bool {
    let shared_bs = &skynet.bs;
    let mut new_bs = false;
    let _bs = match shared_bs {
        Some(bs) if bs.byte_length() >= sz => bs,
        _ => {
            let mut alloc_sz = SHARED_MIN_SZ;
            if let Some(bs) = shared_bs {
                alloc_sz = if bs.byte_length() > 0 {
                    bs.byte_length() * 2
                } else {
                    SHARED_MIN_SZ
                };
            }
            alloc_sz = (sz as f32 / alloc_sz as f32).ceil() as usize * alloc_sz;
            if alloc_sz >= SHARED_MAX_SZ {
                alloc_sz = (sz as f32 / SHARED_MIN_SZ as f32).ceil() as usize * SHARED_MIN_SZ;
            } else if alloc_sz < SHARED_MIN_SZ {
                alloc_sz = SHARED_MIN_SZ;
            }

            //let mut buf = Vec::new();
            //buf.resize(alloc_sz, 0);
            //let bs = v8::SharedArrayBuffer::new_backing_store_from_boxed_slice(buf.into_boxed_slice(),);
            let bs = v8::SharedArrayBuffer::new_backing_store(scope, alloc_sz);
            new_bs = true;

            skynet.bs = Some(bs.make_shared());
            skynet.bs.as_ref().unwrap()
        }
    };
    new_bs
}

pub fn op_skynet_socket_unpack(
    _state: &mut deno_core::JsRuntimeState,
    op_state: Rc<RefCell<OpState>>,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    rv: &mut v8::ReturnValue,
) {
    let ptr1 = get_args!(scope, v8::Integer, args, 1).value() as u64;
    let ptr2 = get_args!(scope, v8::Integer, args, 2).value() as u64;
    let sz = get_args!(scope, v8::Integer, args, 3).value() as usize;
    let msg = ptr1 + ptr2 * 0x100000000;

    let socket_message = unsafe { &mut *(msg as *mut interface::skynet_socket_message) };

    let errmsg_len = if socket_message.buffer == std::ptr::null() {
        if sz <= interface::SKYNET_SOCKET_MESSAGE_SIZE {
            0
        } else {
            sz - interface::SKYNET_SOCKET_MESSAGE_SIZE
        }
    } else {
        0
    };
    let mut buffer_len = 4 + 4 + 4;
    if socket_message.buffer == std::ptr::null() {
        buffer_len += 2;
        buffer_len += errmsg_len;
    } else {
        buffer_len += socket_message.ud as usize;
    }

    let mut udp_addrstring: *const libc::c_char = std::ptr::null();
    let mut udp_addrsz: libc::c_int = 0;
    if socket_message.msg_type == interface::SKYNET_SOCKET_TYPE_UDP {
        udp_addrstring = unsafe {
            interface::skynet_socket_udp_address(
                msg as *mut interface::skynet_socket_message,
                &mut udp_addrsz,
            )
        };
        buffer_len += 2;
        buffer_len += udp_addrsz as usize;
    }

    let mut op_state_rc = op_state.borrow_mut();
    let skynet = op_state_rc.borrow_mut::<SkynetContext>();
    let skynet = unsafe { &mut **skynet };

    let new_bs = get_shared_bs(skynet, scope, buffer_len);
    let buf = unsafe {
        let bs = skynet.bs.as_ref().unwrap();
        get_backing_store_slice_mut(bs, 0, bs.byte_length())
    };

    let mut index = 0;
    LittleEndian::write_i32(&mut buf[index..index + 4], socket_message.msg_type);
    index += 4;
    LittleEndian::write_i32(&mut buf[index..index + 4], socket_message.id);
    index += 4;
    LittleEndian::write_i32(&mut buf[index..index + 4], socket_message.ud);
    index += 4;

    if socket_message.buffer == std::ptr::null() {
        if sz <= interface::SKYNET_SOCKET_MESSAGE_SIZE {
            LittleEndian::write_i16(&mut buf[index..index + 2], 0);
            index += 2;
        } else {
            LittleEndian::write_i16(&mut buf[index..index + 2], errmsg_len as i16);
            index += 2;
            buf[index..index + errmsg_len].copy_from_slice(unsafe {
                std::slice::from_raw_parts(
                    (msg + interface::SKYNET_SOCKET_MESSAGE_SIZE as u64) as *const u8,
                    (sz - interface::SKYNET_SOCKET_MESSAGE_SIZE) as usize,
                )
            });
            index += errmsg_len;
        }
    } else {
        buf[index..index + socket_message.ud as usize].copy_from_slice(unsafe {
            std::slice::from_raw_parts(socket_message.buffer, socket_message.ud as usize)
        });
        index += socket_message.ud as usize;

        unsafe { libc::free(socket_message.buffer as *mut libc::c_void) };
    }

    if socket_message.msg_type == interface::SKYNET_SOCKET_TYPE_UDP {
        if udp_addrstring == std::ptr::null() {
            LittleEndian::write_i16(&mut buf[index..index + 2], 0);
        // index += 2;
        } else {
            LittleEndian::write_i16(&mut buf[index..index + 2], udp_addrsz as i16);
            index += 2;
            buf[index..index + udp_addrsz as usize].copy_from_slice(unsafe {
                std::slice::from_raw_parts(udp_addrstring as *const u8, udp_addrsz as usize)
            });
            // index += udp_addrsz as usize;
        }
    }

    let v8_ret = v8::Boolean::new(scope, new_bs).into();
    rv.set(v8_ret);
}

pub fn op_skynet_socket_bind(state: &mut OpState, fd: i32, _: ()) -> Result<i32, AnyError> {
    let skynet = state.borrow_mut::<SkynetContext>();
    let skynet = unsafe { &mut **skynet };

    let id = unsafe { interface::skynet_socket_bind(skynet.skynet, fd) };

    Ok(id)
}

pub fn op_skynet_socket_start(state: &mut OpState, fd: i32, _: ()) -> Result<(), AnyError> {
    let skynet = state.borrow_mut::<SkynetContext>();
    let skynet = unsafe { &mut **skynet };

    unsafe { interface::skynet_socket_start(skynet.skynet, fd) };

    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocketListenArgs {
    host: String,
    port: i32,
    backlog: i32,
}
pub fn op_skynet_socket_listen(
    state: &mut OpState,
    args: SocketListenArgs,
    _: (),
) -> Result<i32, AnyError> {
    let skynet = state.borrow_mut::<SkynetContext>();
    let skynet = unsafe { &mut **skynet };

    let addr = std::ffi::CString::new(args.host)?;

    let id = unsafe {
        interface::skynet_socket_listen(skynet.skynet, addr.as_ptr(), args.port, args.backlog)
    };

    Ok(id)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocketUdpArgs {
    host: String,
    port: i32,
}
pub fn op_skynet_socket_udp(
    state: &mut OpState,
    args: SocketUdpArgs,
    _: (),
) -> Result<i32, AnyError> {
    let skynet = state.borrow_mut::<SkynetContext>();
    let skynet = unsafe { &mut **skynet };

    let addr = std::ffi::CString::new(args.host)?;

    let id = unsafe { interface::skynet_socket_udp(skynet.skynet, addr.as_ptr(), args.port) };

    Ok(id)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocketUdpConnectArgs {
    id: i32,
    host: String,
    port: i32,
}
pub fn op_skynet_socket_udp_connect(
    state: &mut OpState,
    args: SocketUdpConnectArgs,
    _: (),
) -> Result<(), AnyError> {
    let skynet = state.borrow_mut::<SkynetContext>();
    let skynet = unsafe { &mut **skynet };

    let addr = std::ffi::CString::new(args.host)?;

    unsafe {
        interface::skynet_socket_udp_connect(skynet.skynet, args.id, addr.as_ptr(), args.port)
    };

    Ok(())
}

pub type BufVec = smallvec::SmallVec<[ZeroCopyBuf; 2]>;
pub fn op_skynet_socket_alloc_msg(
    _state: &mut deno_core::JsRuntimeState,
    _op_state: Rc<RefCell<OpState>>,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    rv: &mut v8::ReturnValue,
) {
    let mut sz = 0;
    let buf_iter = (1..args.length()).map(|idx| {
        v8::Local::<v8::ArrayBufferView>::try_from(args.get(idx))
            .map(|view| {
                sz += view.byte_length();
                ZeroCopyBuf::new(scope, view)
            })
            .map_err(|err| {
                let msg = format!("Invalid argument at position {}: {}", idx, err);
                let msg = v8::String::new(scope, &msg).unwrap();
                v8::Exception::type_error(scope, msg)
            })
    });

    let mut bufs: BufVec = match buf_iter.collect::<Result<_, _>>() {
        Ok(bufs) => bufs,
        Err(exc) => {
            scope.throw_exception(exc);
            return;
        }
    };

    let dest = unsafe { libc::malloc(sz) };
    sz = 0;
    for buf in &mut bufs {
        let buf_sz = (buf as &[u8]).len();
        unsafe {
            libc::memcpy(dest.add(sz), buf.as_ptr() as *const libc::c_void, buf_sz);
        }
        sz += buf_sz;
    }

    let v8_dest = v8::BigInt::new_from_u64(scope, dest as u64).into();
    let v8_sz = v8::Integer::new(scope, sz as i32).into();
    let v8_ret = v8::Array::new(scope, 2);
    v8_ret.set_index(scope, 0, v8_dest);
    v8_ret.set_index(scope, 1, v8_sz);
    rv.set(v8_ret.into());
}

pub fn op_skynet_socket_send(
    _state: &mut deno_core::JsRuntimeState,
    op_state: Rc<RefCell<OpState>>,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    rv: &mut v8::ReturnValue,
) {
    let id = get_args!(scope, v8::Integer, args, 1).value();
    let msg = get_args!(scope, v8::BigInt, args, 2).u64_value().0;
    let sz = get_args!(scope, v8::Integer, args, 3).value();

    let mut buffer = interface::socket_sendbuffer {
        id: id as libc::c_int,
        msg_type: 0 as libc::c_int,
        buffer: msg as *const u8,
        sz: sz as libc::size_t,
    };

    let mut op_state_rc = op_state.borrow_mut();
    let skynet = op_state_rc.borrow_mut::<SkynetContext>();
    let skynet = unsafe { &mut **skynet };

    let err = unsafe { interface::skynet_socket_sendbuffer(skynet.skynet, &mut buffer) };

    let v8_ret = v8::Integer::new(scope, err as i32).into();
    rv.set(v8_ret);
}

pub fn op_skynet_socket_send_lowpriority(
    _state: &mut deno_core::JsRuntimeState,
    op_state: Rc<RefCell<OpState>>,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    rv: &mut v8::ReturnValue,
) {
    let id = get_args!(scope, v8::Integer, args, 1).value();
    let msg = get_args!(scope, v8::BigInt, args, 2).u64_value().0;
    let sz = get_args!(scope, v8::Integer, args, 3).value();

    let mut buffer = interface::socket_sendbuffer {
        id: id as libc::c_int,
        msg_type: 0 as libc::c_int,
        buffer: msg as *const u8,
        sz: sz as libc::size_t,
    };

    let mut op_state_rc = op_state.borrow_mut();
    let skynet = op_state_rc.borrow_mut::<SkynetContext>();
    let skynet = unsafe { &mut **skynet };

    let err =
        unsafe { interface::skynet_socket_sendbuffer_lowpriority(skynet.skynet, &mut buffer) };

    let v8_ret = v8::Integer::new(scope, err as i32).into();
    rv.set(v8_ret);
}

pub fn op_skynet_socket_sendto(
    _state: &mut deno_core::JsRuntimeState,
    op_state: Rc<RefCell<OpState>>,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    rv: &mut v8::ReturnValue,
) {
    let id = get_args!(scope, v8::Integer, args, 1).value();
    let address = get_args!(scope, v8::String, args, 2).to_rust_string_lossy(scope);
    let msg = get_args!(scope, v8::BigInt, args, 3).u64_value().0;
    let sz = get_args!(scope, v8::Integer, args, 4).value();
    let addr = std::ffi::CString::new(address).unwrap();

    let mut buffer = interface::socket_sendbuffer {
        id: id as libc::c_int,
        msg_type: 0 as libc::c_int,
        buffer: msg as *const u8,
        sz: sz as libc::size_t,
    };

    let mut op_state_rc = op_state.borrow_mut();
    let skynet = op_state_rc.borrow_mut::<SkynetContext>();
    let skynet = unsafe { &mut **skynet };

    let err = unsafe {
        interface::skynet_socket_udp_sendbuffer(skynet.skynet, addr.as_ptr(), &mut buffer)
    };

    let v8_ret = v8::Integer::new(scope, err as i32).into();
    rv.set(v8_ret);
}

pub fn op_skynet_socket_nodelay(state: &mut OpState, fd: i32, _: ()) -> Result<(), AnyError> {
    let skynet = state.borrow_mut::<SkynetContext>();
    let skynet = unsafe { &mut **skynet };
    unsafe { interface::skynet_socket_nodelay(skynet.skynet, fd) };

    Ok(())
}
