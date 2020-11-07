// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.

use crate::error::AnyError;
use crate::serde_json;
use crate::serde_json::json;
use crate::serde_json::Value;
use crate::OpState;
use crate::ZeroCopyBuf;
use serde::Deserialize;

pub fn init(rt: &mut crate::JsRuntime) {
    super::reg_json_sync(rt, "op_apply_source_map", op_apply_source_map);
    super::reg_json_sync(rt, "op_format_diagnostic", op_format_diagnostic);
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplySourceMap {
    file_name: String,
    line_number: i32,
    column_number: i32,
}

fn op_apply_source_map(
    _state: &mut OpState,
    args: Value,
    _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
    let args: ApplySourceMap = serde_json::from_value(args)?;

    //let mut mappings_map: CachedMaps = HashMap::new();
    /*
    get_orig_position(
      args.file_name,
      args.line_number.into(),
      args.column_number.into(),
      &mut mappings_map,
      &super::global_state(state).ts_compiler,
    );
    */

    Ok(json!({
      "fileName": args.file_name,
      "lineNumber": args.line_number,
      "columnNumber": args.column_number,
    }))
}

fn op_format_diagnostic(
    _state: &mut OpState,
    args: Value,
    _zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
    //let diagnostic: Diagnostics = serde_json::from_value(args)?;
    Ok(json!(args))
}
