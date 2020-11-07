// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.
pub mod errors;
pub mod os;
pub mod random;
pub mod skynet;

use crate::error::AnyError;
use crate::json_op_sync;
use crate::serde_json::Value;
use crate::JsRuntime;
use crate::OpState;
use crate::ZeroCopyBuf;

pub fn reg_json_sync<F>(rt: &mut JsRuntime, name: &'static str, op_fn: F)
where
    F: Fn(&mut OpState, Value, &mut [ZeroCopyBuf]) -> Result<Value, AnyError> + 'static,
{
    rt.register_op(name, json_op_sync(op_fn));
}
