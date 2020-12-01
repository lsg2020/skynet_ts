use crate::error::AnyError;
use crate::serde_json;
use crate::serde_json::json;
use crate::serde_json::Value;
use crate::JsRuntime;
use crate::JsRuntimeState;
use crate::OpState;
use crate::ZeroCopyBuf;
use serde::Deserialize;
use std::cell::RefCell;
use std::rc::Rc;
use rusty_v8 as v8;

pub fn init(rt: &mut JsRuntime) {
    super::reg_json_sync(rt, "op_skynet_command", op_skynet_command);
    super::reg_json_sync(rt, "op_skynet_send", op_skynet_send);
    super::reg_json_sync(rt, "op_skynet_send_name", op_skynet_send_name);
    super::reg_json_sync(rt, "op_skynet_error", op_skynet_error);
    //super::reg_json_sync(rt, "op_skynet_now", op_skynet_now);
    rt.register_op("op_skynet_now", op_skynet_now_raw);
    rt.register_op("op_skynet_genid", op_skynet_genid);
    rt.register_op("op_skynet_fetch_message", op_skynet_fetch_message);
}

#[derive(Deserialize)]
#[serde()]
struct CommandArgs {
    cmd: String,
    param: Option<String>,
}
pub fn op_skynet_command(
    state: &mut OpState,
    args: Value,
    _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
    let args: CommandArgs = serde_json::from_value(args)?;

    let cmd = std::ffi::CString::new(args.cmd).unwrap();
    let result = unsafe {
        match args.param {
            Some(param) => {
                let param = std::ffi::CString::new(param).unwrap();
                crate::skynet_command(state.skynet, cmd.as_ptr(), param.as_ptr())
            }
            None => crate::skynet_command(state.skynet, cmd.as_ptr(), std::ptr::null()),
        }
    };

    if result == std::ptr::null() {
        Ok(json!({}))
    } else {
        let r = unsafe { String::from(std::ffi::CStr::from_ptr(result).to_str().unwrap()) };
        Ok(json!({ "result": r }))
    }
}

#[derive(Deserialize)]
#[serde()]
struct ErrorArgs {
    error: String,
}
pub fn op_skynet_error(
    state: &mut OpState,
    args: Value,
    _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
    let args: ErrorArgs = serde_json::from_value(args)?;

    let error = std::ffi::CString::new(args.error).unwrap();
    unsafe { crate::skynet_error(state.skynet, error.as_ptr()) };
    Ok(json!({}))
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
#[serde()]
struct SendArgs {
    dest: libc::c_uint,
    ptype: libc::c_int,
    session: libc::c_int,
}
pub fn op_skynet_send(
    state: &mut OpState,
    args: Value,
    zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
    let args: SendArgs = serde_json::from_value(args)?;
    let (msg_buf, msg_sz) = merge_bufs(zero_copy);

    let session = unsafe {
        crate::skynet_send(
            state.skynet,
            0,
            args.dest,
            args.ptype | crate::PTYPE_TAG_DONTCOPY,
            args.session,
            msg_buf,
            msg_sz,
        )
    };
    Ok(json!({ "session": session }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendNameArgs {
    name: String,
    ptype: libc::c_int,
    session: libc::c_int,
}
pub fn op_skynet_send_name(
    state: &mut OpState,
    args: Value,
    zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
    let args: SendNameArgs = serde_json::from_value(args)?;
    let (msg_buf, msg_sz) = merge_bufs(zero_copy);

    let session = unsafe {
        crate::skynet_sendname(
            state.skynet,
            0,
            std::ffi::CString::new(args.name).unwrap().as_ptr(),
            args.ptype | crate::PTYPE_TAG_DONTCOPY,
            args.session,
            msg_buf,
            msg_sz,
        )
    };
    Ok(json!({ "session": session }))
}

pub fn _op_skynet_now(
    _state: &mut OpState,
    _args: Value,
    _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
    let now = unsafe { crate::skynet_now() };
    Ok(json!(now))
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

    if sz > 0 {
        let buf = unsafe { crate::bindings::get_backing_store_slice_mut(&buffer, 0, buffer.byte_length()) };
        buf[0..sz].copy_from_slice(unsafe { std::slice::from_raw_parts(msg as *const u8, sz) });
    }

    let v8_sz = v8::Integer::new(scope, sz as i32).into();
    rv.set(v8_sz);
}
