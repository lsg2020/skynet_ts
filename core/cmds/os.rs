// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.

use crate::error::AnyError;
use crate::serde_json;
use crate::serde_json::json;
use crate::serde_json::Value;
use crate::url::Url;
use crate::OpState;
use crate::ZeroCopyBuf;
use crate::JsRuntimeState;
use serde::Deserialize;
use std::collections::HashMap;
use std::env;
use std::cell::RefCell;
use std::rc::Rc;

use rusty_v8 as v8;

pub fn init(rt: &mut crate::JsRuntime) {
    super::reg_json_sync(rt, "op_exit", op_exit);
    super::reg_json_sync(rt, "op_env", op_env);
    super::reg_json_sync(rt, "op_exec_path", op_exec_path);
    super::reg_json_sync(rt, "op_set_env", op_set_env);
    super::reg_json_sync(rt, "op_get_env", op_get_env);
    super::reg_json_sync(rt, "op_delete_env", op_delete_env);
    super::reg_json_sync(rt, "op_hostname", op_hostname);
    super::reg_json_sync(rt, "op_loadavg", op_loadavg);
    super::reg_json_sync(rt, "op_os_release", op_os_release);
    super::reg_json_sync(rt, "op_system_memory_info", op_system_memory_info);
    super::reg_json_sync(rt, "op_file_exists", op_file_exists);
    rt.register_op("op_v8_memory_info", op_v8_memory_info);
}

fn op_exec_path(
    _state: &mut OpState,
    _args: Value,
    _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
    let current_exe = env::current_exe().unwrap();
    // Now apply URL parser to current exe to get fully resolved path, otherwise
    // we might get `./` and `../` bits in `exec_path`
    let exe_url = Url::from_file_path(current_exe).unwrap();
    let path = exe_url.to_file_path().unwrap();
    Ok(json!(path))
}

#[derive(Deserialize)]
struct SetEnv {
    key: String,
    value: String,
}

fn op_set_env(
    _state: &mut OpState,
    args: Value,
    _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
    let args: SetEnv = serde_json::from_value(args)?;

    env::set_var(args.key, args.value);
    Ok(json!({}))
}

fn op_env(
    _state: &mut OpState,
    _args: Value,
    _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
    let v = env::vars().collect::<HashMap<String, String>>();
    Ok(json!(v))
}

#[derive(Deserialize)]
struct GetEnv {
    key: String,
}

fn op_get_env(
    _state: &mut OpState,
    args: Value,
    _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
    let args: GetEnv = serde_json::from_value(args)?;
    let r = match env::var(args.key) {
        Err(env::VarError::NotPresent) => json!([]),
        v => json!([v?]),
    };
    Ok(r)
}

#[derive(Deserialize)]
struct DeleteEnv {
    key: String,
}

fn op_delete_env(
    _state: &mut OpState,
    args: Value,
    _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
    let args: DeleteEnv = serde_json::from_value(args)?;
    env::remove_var(args.key);
    Ok(json!({}))
}

#[derive(Deserialize)]
struct Exit {
    code: i32,
}

fn op_exit(
    _state: &mut OpState,
    args: Value,
    _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
    let args: Exit = serde_json::from_value(args)?;
    std::process::exit(args.code)
}

fn op_loadavg(
    _state: &mut OpState,
    _args: Value,
    _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
    match sys_info::loadavg() {
        Ok(loadavg) => Ok(json!([loadavg.one, loadavg.five, loadavg.fifteen])),
        Err(_) => Ok(json!([0f64, 0f64, 0f64])),
    }
}

fn op_hostname(
    _state: &mut OpState,
    _args: Value,
    _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
    let hostname = sys_info::hostname().unwrap_or_else(|_| "".to_string());
    Ok(json!(hostname))
}

fn op_os_release(
    _state: &mut OpState,
    _args: Value,
    _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
    let release = sys_info::os_release().unwrap_or_else(|_| "".to_string());
    Ok(json!(release))
}

fn op_system_memory_info(
    _state: &mut OpState,
    _args: Value,
    _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
    match sys_info::mem_info() {
        Ok(info) => Ok(json!({
          "total": info.total,
          "free": info.free,
          "available": info.avail,
          "buffers": info.buffers,
          "cached": info.cached,
          "swapTotal": info.swap_total,
          "swapFree": info.swap_free
        })),
        Err(_) => Ok(json!({})),
    }
}

fn op_v8_memory_info(
    _state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    _args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let mut s = v8::HeapStatistics::default();
    scope.get_heap_statistics(&mut s);

    let ret = json!({
        "total_heap_size": s.total_heap_size(),
        "total_heap_size_executable": s.total_heap_size_executable(),
        "total_physical_size": s.total_physical_size(),
        "total_available_size": s.total_available_size(),
        "total_global_handles_size": s.total_global_handles_size(),
        "used_global_handles_size": s.used_global_handles_size(),
        "used_heap_size": s.used_heap_size(),
        "heap_size_limit": s.heap_size_limit(),
        "malloced_memory": s.malloced_memory(),
        "external_memory": s.external_memory(),
        "peak_malloced_memory": s.peak_malloced_memory(),
        "number_of_native_contexts": s.number_of_native_contexts(),
        "number_of_detached_contexts": s.number_of_detached_contexts(),
        "does_zap_garbage": s.does_zap_garbage(),
    });

    let buf = serde_json::to_vec(&ret).unwrap().into_boxed_slice();
    rv.set(crate::bindings::boxed_slice_to_uint8array(scope, buf).into());
}

#[derive(Deserialize)]
#[serde()]
struct PathExistsArgs {
    path: String,
}
pub fn op_file_exists(
    _state: &mut OpState,
    args: Value,
    _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
    let args: PathExistsArgs = serde_json::from_value(args)?;
    Ok(json!(std::path::Path::new(&args.path).is_file()))
}
