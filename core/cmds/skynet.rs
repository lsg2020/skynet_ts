use crate::error::AnyError;
use crate::JsRuntime;
use crate::JsRuntimeState;
use crate::OpState;
use crate::ZeroCopyBuf;
use crate::BufVec;
use std::cell::RefCell;
use std::rc::Rc;
use rusty_v8 as v8;

pub fn init(rt: &mut JsRuntime) {
    rt.register_op("op_skynet_command", op_skynet_command);
    rt.register_op("op_skynet_send", op_skynet_send);
    rt.register_op("op_skynet_send_name", op_skynet_send_name);    
    rt.register_op("op_skynet_error", op_skynet_error);
    rt.register_op("op_skynet_now", op_skynet_now_raw);
    rt.register_op("op_skynet_genid", op_skynet_genid);
    rt.register_op("op_skynet_fetch_message", op_skynet_fetch_message);
    rt.register_op("op_skynet_free", op_skynet_free);
    rt.register_op("op_skynet_socket_connect", op_skynet_socket_connect);
    rt.register_op("op_skynet_socket_close", op_skynet_socket_close);
    rt.register_op("op_skynet_socket_shutdown", op_skynet_socket_shutdown);
    rt.register_op("op_skynet_socket_unpack", op_skynet_socket_unpack);
    rt.register_op("op_skynet_socket_bind", op_skynet_socket_bind);
    rt.register_op("op_skynet_socket_start", op_skynet_socket_start);
    rt.register_op("op_skynet_socket_listen", op_skynet_socket_listen);
    rt.register_op("op_skynet_socket_udp", op_skynet_socket_udp);
    rt.register_op("op_skynet_socket_udp_connect", op_skynet_socket_udp_connect);
    rt.register_op("op_skynet_socket_alloc_msg", op_skynet_socket_alloc_msg);
    rt.register_op("op_skynet_socket_send", op_skynet_socket_send);
    rt.register_op("op_skynet_socket_send_lowpriority", op_skynet_socket_send_lowpriority);
    rt.register_op("op_skynet_socket_sendto", op_skynet_socket_sendto);
    rt.register_op("op_skynet_socket_nodelay", op_skynet_socket_nodelay);
}

pub fn op_skynet_command(
    state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let state = &mut state.borrow_mut();
    let cmd = crate::get_args!(scope, v8::String, args, 1).to_rust_string_lossy(scope);
    let param = crate::get_args!(scope, v8::String, args, 2).to_rust_string_lossy(scope);

    let cmd = std::ffi::CString::new(cmd).unwrap();
    let param = std::ffi::CString::new(param).unwrap();
    let result = unsafe { crate::skynet_command(state.skynet, cmd.as_ptr(), param.as_ptr()) };

    if result != std::ptr::null() {
        let r = unsafe { String::from(std::ffi::CStr::from_ptr(result).to_str().unwrap()) };
        let v8_ret = v8::String::new(scope, &r).unwrap().into();
        rv.set(v8_ret);
    }
}

pub fn op_skynet_error(
    state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _rv: v8::ReturnValue,
) {
    let state = &mut state.borrow_mut();
    let err = crate::get_args!(scope, v8::String, args, 1).to_rust_string_lossy(scope);

    let error = std::ffi::CString::new(err).unwrap();
    unsafe { crate::skynet_error(state.skynet, error.as_ptr()) };
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

pub fn op_skynet_send(
    state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let dest = crate::get_args!(scope, v8::Integer, args, 1).value() as libc::c_uint;
    let ptype = crate::get_args!(scope, v8::Integer, args, 2).value() as libc::c_int;
    let session = crate::get_args!(scope, v8::Integer, args, 3).value() as libc::c_int;

    let buf_iter = (4..args.length()).map(|idx| {
        v8::Local::<v8::ArrayBufferView>::try_from(args.get(idx))
            .map(|view| {
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

    let (msg_buf, msg_sz) = merge_bufs(&mut bufs);

    let state = &mut state.borrow_mut();
    let session = unsafe {
        crate::skynet_send(
            state.skynet,
            0,
            dest,
            ptype | crate::PTYPE_TAG_DONTCOPY,
            session,
            msg_buf,
            msg_sz,
        )
    };
    let v8_session = v8::Integer::new(scope, session as i32).into();
    rv.set(v8_session);
}

pub fn op_skynet_send_name(
    state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let name = crate::get_args!(scope, v8::String, args, 1).to_rust_string_lossy(scope);
    let ptype = crate::get_args!(scope, v8::Integer, args, 2).value() as libc::c_int;
    let session = crate::get_args!(scope, v8::Integer, args, 3).value() as libc::c_int;

    let buf_iter = (4..args.length()).map(|idx| {
        v8::Local::<v8::ArrayBufferView>::try_from(args.get(idx))
            .map(|view| {
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

    let (msg_buf, msg_sz) = merge_bufs(&mut bufs);

    let state = &mut state.borrow_mut();
    let session = unsafe {
        crate::skynet_sendname(
            state.skynet,
            0,
            std::ffi::CString::new(name).unwrap().as_ptr(),
            ptype | crate::PTYPE_TAG_DONTCOPY,
            session,
            msg_buf,
            msg_sz,
        )
    };
    let v8_session = v8::Integer::new(scope, session as i32).into();
    rv.set(v8_session);
}

pub fn op_skynet_now_raw(
    _state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    _args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let now = unsafe { crate::skynet_now() };
    let v8_now = v8::Integer::new(scope, now as i32).into();
    rv.set(v8_now);
}

pub fn op_skynet_genid(
    state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    _args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let state = &mut state.borrow_mut();
    let session = unsafe {
        crate::skynet_send(
            state.skynet,
            0,
            0,
            crate::PTYPE_TAG_ALLOCSESSION,
            0,
            std::ptr::null(),
            0,
        )
    };

    let v8_session = v8::Integer::new(scope, session as i32).into();
    rv.set(v8_session);
}

use std::convert::TryFrom;
pub fn op_skynet_fetch_message(
    _state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let msg = crate::get_args!(scope, v8::BigInt, args, 1).u64_value().0;
    let sz = crate::get_args!(scope, v8::Integer, args, 2).value() as libc::size_t;
    let buffer = crate::get_args!(scope, v8::ArrayBuffer, args, 3);
    let buffer = v8::ArrayBuffer::get_backing_store(&buffer);
    let offset = crate::get_args!(scope, v8::Integer, args, 4).value() as libc::size_t;

    if sz > 0 {
        let buf = unsafe { crate::bindings::get_backing_store_slice_mut(&buffer, 0, buffer.byte_length()) };
        buf[offset..sz+offset].copy_from_slice(unsafe { std::slice::from_raw_parts(msg as *const u8, sz) });
    }

    let v8_sz = v8::Integer::new(scope, sz as i32).into();
    rv.set(v8_sz);
}

pub fn op_skynet_free(
    _state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _rv: v8::ReturnValue,
) {
    let msg = crate::get_args!(scope, v8::BigInt, args, 1).u64_value().0;
    unsafe { libc::free(msg as *mut libc::c_void) };
}

pub fn op_skynet_socket_connect(
    state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let state = &mut state.borrow();

    let addr = crate::get_args!(scope, v8::String, args, 1).to_rust_string_lossy(scope);
    let port = crate::get_args!(scope, v8::Integer, args, 2).value();

    let id = unsafe {
        crate::skynet_socket_connect(
            state.skynet,
            std::ffi::CString::new(addr).unwrap().as_ptr(),
            port as libc::c_int,
        )
    };

    let v8_ret = v8::Integer::new(scope, id as i32).into();
    rv.set(v8_ret);
}

pub fn op_skynet_socket_close(
    state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _rv: v8::ReturnValue, 
) {
    let state = &mut state.borrow();
    let socket_id = crate::get_args!(scope, v8::Integer, args, 1).value();
    unsafe { crate::skynet_socket_close(state.skynet, socket_id as i32); };
}

pub fn op_skynet_socket_shutdown(
    state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _rv: v8::ReturnValue, 
) {
    let state = &mut state.borrow();
    let socket_id = crate::get_args!(scope, v8::Integer, args, 1).value();
    unsafe { crate::skynet_socket_shutdown(state.skynet, socket_id as i32); };
}

pub fn op_skynet_socket_unpack(
    _state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let msg = crate::get_args!(scope, v8::BigInt, args, 1).u64_value().0;
    let sz = crate::get_args!(scope, v8::Integer, args, 2).value() as u64;

    let socket_message = unsafe { &mut *(msg as *mut crate::skynet_socket_message) };

    let mut rv_len = 4;
    if socket_message.msg_type == crate::SKYNET_SOCKET_TYPE_UDP {
        rv_len = 5;
    }

    let msg_type = v8::Integer::new(scope, socket_message.msg_type).into();
    let id = v8::Integer::new(scope, socket_message.id).into();
    let ud = v8::Integer::new(scope, socket_message.ud).into();

    let v8_ret = v8::Array::new(scope, rv_len);
    v8_ret.set_index(scope, 0, msg_type);
    v8_ret.set_index(scope, 1, id);
    v8_ret.set_index(scope, 2, ud);
    if socket_message.buffer == std::ptr::null() {
        let data;
        if sz <= crate::SKYNET_SOCKET_MESSAGE_SIZE {
            data = v8::String::new(scope, "").unwrap().into();
        } else {
            data = v8::String::new_from_utf8(scope, unsafe { std::slice::from_raw_parts((msg + crate::SKYNET_SOCKET_MESSAGE_SIZE) as *const u8, (sz - crate::SKYNET_SOCKET_MESSAGE_SIZE) as usize) }, v8::NewStringType::Normal).unwrap().into();
        }
        v8_ret.set_index(scope, 3, data);
    } else {
        let data = v8::BigInt::new_from_u64(scope, socket_message.buffer as u64).into();
        v8_ret.set_index(scope, 3, data);
    }

    if socket_message.msg_type == crate::SKYNET_SOCKET_TYPE_UDP {
        let mut addrsz: libc::c_int = 0;
        let addrstring = unsafe { crate::skynet_socket_udp_address(msg as *mut crate::skynet_socket_message, &mut addrsz) };
        let data;
        if addrstring == std::ptr::null() {
            data = v8::String::new(scope, "").unwrap().into();
        } else {
            data = v8::String::new_from_utf8(scope, unsafe { std::slice::from_raw_parts(addrstring as *const u8, addrsz as usize) }, v8::NewStringType::Normal).unwrap().into();
        }
        v8_ret.set_index(scope, 4, data);
    }
    rv.set(v8_ret.into());
}

pub fn op_skynet_socket_bind(
    state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let state = &mut state.borrow();

    let fd = crate::get_args!(scope, v8::Integer, args, 1).value();

    let id = unsafe {
        crate::skynet_socket_bind(
            state.skynet,
            fd as libc::c_int,
        )
    };

    let v8_ret = v8::Integer::new(scope, id as i32).into();
    rv.set(v8_ret);
}

pub fn op_skynet_socket_start(
    state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _rv: v8::ReturnValue,
) {
    let state = &mut state.borrow();

    let id = crate::get_args!(scope, v8::Integer, args, 1).value();

    unsafe {
        crate::skynet_socket_start(
            state.skynet,
            id as libc::c_int,
        )
    };
}

pub fn op_skynet_socket_listen(
    state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let state = &mut state.borrow();

    let host = crate::get_args!(scope, v8::String, args, 1).to_rust_string_lossy(scope);
    let port = crate::get_args!(scope, v8::Integer, args, 2).value();
    let backlog = crate::get_args!(scope, v8::Integer, args, 3).value();

    let id = unsafe {
        crate::skynet_socket_listen(
            state.skynet,
            std::ffi::CString::new(host).unwrap().as_ptr(),
            port as libc::c_int,
            backlog as libc::c_int,
        )
    };

    let v8_ret = v8::Integer::new(scope, id as i32).into();
    rv.set(v8_ret);
}


pub fn op_skynet_socket_udp(
    state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let state = &mut state.borrow();

    let host = crate::get_args!(scope, v8::String, args, 1).to_rust_string_lossy(scope);
    let port = crate::get_args!(scope, v8::Integer, args, 2).value();

    let id = unsafe {
        crate::skynet_socket_udp(
            state.skynet,
            std::ffi::CString::new(host).unwrap().as_ptr(),
            port as libc::c_int,
        )
    };

    let v8_ret = v8::Integer::new(scope, id as i32).into();
    rv.set(v8_ret);
}

pub fn op_skynet_socket_udp_connect(
    state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _rv: v8::ReturnValue,
) {
    let state = &mut state.borrow();

    let id = crate::get_args!(scope, v8::Integer, args, 1).value();
    let host = crate::get_args!(scope, v8::String, args, 2).to_rust_string_lossy(scope);
    let port = crate::get_args!(scope, v8::Integer, args, 3).value();

    unsafe {
        crate::skynet_socket_udp_connect(
            state.skynet,
            id as libc::c_int,
            std::ffi::CString::new(host).unwrap().as_ptr(),
            port as libc::c_int,
        )
    };
}

pub fn op_skynet_socket_alloc_msg(
    _state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
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
    state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let state = &mut state.borrow();

    let id = crate::get_args!(scope, v8::Integer, args, 1).value();
    let msg = crate::get_args!(scope, v8::BigInt, args, 2).u64_value().0;
    let sz = crate::get_args!(scope, v8::Integer, args, 3).value();

    let mut buffer = crate::socket_sendbuffer {
        id: id as libc::c_int,
        msg_type: 0 as libc::c_int,
        buffer: msg as *const u8,
        sz: sz as libc::size_t,
    };

    let err = unsafe {
        crate::skynet_socket_sendbuffer(
            state.skynet,
            &mut buffer,
        )
    };

    let v8_ret = v8::Integer::new(scope, err as i32).into();
    rv.set(v8_ret);
}

pub fn op_skynet_socket_send_lowpriority(
    state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let state = &mut state.borrow();

    let id = crate::get_args!(scope, v8::Integer, args, 1).value();
    let msg = crate::get_args!(scope, v8::BigInt, args, 2).u64_value().0;
    let sz = crate::get_args!(scope, v8::Integer, args, 3).value();

    let mut buffer = crate::socket_sendbuffer {
        id: id as libc::c_int,
        msg_type: 0 as libc::c_int,
        buffer: msg as *const u8,
        sz: sz as libc::size_t,
    };

    let err = unsafe {
        crate::skynet_socket_sendbuffer_lowpriority(
            state.skynet,
            &mut buffer,
        )
    };

    let v8_ret = v8::Integer::new(scope, err as i32).into();
    rv.set(v8_ret);
}

pub fn op_skynet_socket_sendto(
    state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let state = &mut state.borrow();

    let id = crate::get_args!(scope, v8::Integer, args, 1).value();
    let address = crate::get_args!(scope, v8::String, args, 2).to_rust_string_lossy(scope);
    let msg = crate::get_args!(scope, v8::BigInt, args, 3).u64_value().0;
    let sz = crate::get_args!(scope, v8::Integer, args, 4).value();

    let mut buffer = crate::socket_sendbuffer {
        id: id as libc::c_int,
        msg_type: 0 as libc::c_int,
        buffer: msg as *const u8,
        sz: sz as libc::size_t,
    };

    let err = unsafe {
        crate::skynet_socket_udp_sendbuffer(
            state.skynet,
            std::ffi::CString::new(address).unwrap().as_ptr(),
            &mut buffer,
        )
    };

    let v8_ret = v8::Integer::new(scope, err as i32).into();
    rv.set(v8_ret);
}

pub fn op_skynet_socket_nodelay(
    state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _rv: v8::ReturnValue,
) {
    let state = &mut state.borrow();

    let id = crate::get_args!(scope, v8::Integer, args, 1).value();

    unsafe {
        crate::skynet_socket_nodelay(
            state.skynet,
            id as libc::c_int,
        )
    };
}
