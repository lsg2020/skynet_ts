// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.

use crate::error::AnyError;
use crate::gotham_state::GothamState;
use crate::BufVec;
use crate::JsRuntimeState;
use crate::ZeroCopyBuf;
use indexmap::IndexMap;
use serde_json::Value;
use std::cell::RefCell;
use std::collections::HashMap;
use std::convert::TryFrom;
use std::iter::once;
use std::ops::Deref;
use std::ops::DerefMut;
use std::rc::Rc;

use rusty_v8 as v8;

pub type OpFn = dyn Fn(
        Rc<RefCell<OpState>>,
        &mut JsRuntimeState,
        &mut v8::HandleScope,
        v8::FunctionCallbackArguments,
        v8::ReturnValue,
    ) + 'static;
pub type OpId = usize;

pub struct OpState {
    pub resource_table: crate::ResourceTable,
    pub op_table: OpTable,
    pub get_error_class_fn: crate::runtime::GetErrorClassFn,
    gotham_state: GothamState,
    pub skynet: *const std::ffi::c_void,
}

impl Default for OpState {
    // TODO(ry) Only deno_core should be able to construct an OpState. But I don't
    // know how to make default private. Maybe rename to
    //   pub(crate) fn new() -> OpState
    fn default() -> OpState {
        OpState {
            resource_table: crate::ResourceTable::default(),
            op_table: OpTable::default(),
            get_error_class_fn: &|_| "Error",
            gotham_state: GothamState::default(),
            skynet: std::ptr::null(),
        }
    }
}

impl Deref for OpState {
    type Target = GothamState;

    fn deref(&self) -> &Self::Target {
        &self.gotham_state
    }
}

impl DerefMut for OpState {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.gotham_state
    }
}

/// Collection for storing registered ops. The special 'get_op_catalog'
/// op with OpId `0` is automatically added when the OpTable is created.
pub struct OpTable(IndexMap<String, Rc<OpFn>>);

impl OpTable {
    pub fn register_op<F>(&mut self, name: &str, op_fn: F) -> OpId
    where
        F: Fn(
                Rc<RefCell<OpState>>,
                &mut JsRuntimeState,
                &mut v8::HandleScope,
                v8::FunctionCallbackArguments,
                v8::ReturnValue,
            ) + 'static,
    {
        let (op_id, prev) = self.0.insert_full(name.to_owned(), Rc::new(op_fn));
        assert!(prev.is_none());
        op_id
    }

    pub fn route_op(
        op_id: OpId,
        state: Rc<RefCell<OpState>>,
        s: &mut crate::JsRuntimeState,
        scope: &mut v8::HandleScope,
        args: v8::FunctionCallbackArguments,
        mut rv: v8::ReturnValue,
    ) {
        if op_id == 0 {
            let ops: HashMap<String, OpId> =
                state.borrow().op_table.0.keys().cloned().zip(0..).collect();
            let buf: Box<[u8]> = serde_json::to_vec(&ops).map(Into::into).unwrap();

            rv.set(crate::bindings::boxed_slice_to_uint8array(scope, buf).into())
        } else {
            let op_fn = state
                .borrow()
                .op_table
                .0
                .get_index(op_id)
                .map(|(_, op_fn)| op_fn.clone());
            match op_fn {
                Some(f) => (f)(state, s, scope, args, rv),
                None => {
                    let msg = format!("Unknown op id: {}", op_id);
                    let msg = v8::String::new(scope, &msg).unwrap();
                    let exc = v8::Exception::type_error(scope, msg);
                    scope.throw_exception(exc);
                }
            };
        }
    }
}

impl Default for OpTable {
    fn default() -> Self {
        fn dummy(
            _state: Rc<RefCell<OpState>>,
            _s: &mut JsRuntimeState,
            _scope: &mut v8::HandleScope,
            _args: v8::FunctionCallbackArguments,
            _rv: v8::ReturnValue,
        ) {
            unreachable!();
        }
        Self(once(("ops".to_owned(), Rc::new(dummy) as _)).collect())
    }
}

#[test]
fn op_table() {
    let state = Rc::new(RefCell::new(OpState::default()));

    let foo_id;
    let bar_id;
    {
        let op_table = &mut state.borrow_mut().op_table;
        foo_id = op_table.register_op("foo", |_, _| Op::Sync(b"oof!"[..].into()));
        assert_eq!(foo_id, 1);
        bar_id = op_table.register_op("bar", |_, _| Op::Sync(b"rab!"[..].into()));
        assert_eq!(bar_id, 2);
    }

    let foo_res = OpTable::route_op(foo_id, state.clone(), Default::default());
    assert!(matches!(foo_res, Op::Sync(buf) if &*buf == b"oof!"));
    let bar_res = OpTable::route_op(bar_id, state.clone(), Default::default());
    assert!(matches!(bar_res, Op::Sync(buf) if &*buf == b"rab!"));

    let catalog_res = OpTable::route_op(0, state, Default::default());
    let mut catalog_entries = match catalog_res {
        Op::Sync(buf) => serde_json::from_slice::<HashMap<String, OpId>>(&buf)
            .map(|map| map.into_iter().collect::<Vec<_>>())
            .unwrap(),
        _ => panic!("unexpected `Op` variant"),
    };
    catalog_entries.sort_by(|(_, id1), (_, id2)| id1.partial_cmp(id2).unwrap());
    assert_eq!(
        catalog_entries,
        vec![
            ("ops".to_owned(), 0),
            ("foo".to_owned(), 1),
            ("bar".to_owned(), 2)
        ]
    )
}

pub fn json_op_sync<F>(op_fn: F) -> Box<OpFn>
where
    F: Fn(&mut OpState, Value, &mut [ZeroCopyBuf]) -> Result<Value, AnyError> + 'static,
{
    Box::new(
        move |state: Rc<RefCell<OpState>>,
              _s: &mut JsRuntimeState,
              scope: &mut v8::HandleScope,
              args: v8::FunctionCallbackArguments,
              mut rv: v8::ReturnValue| {
            let buf_iter = (1..args.length()).map(|idx| {
                v8::Local::<v8::ArrayBufferView>::try_from(args.get(idx))
                    .map(|view| ZeroCopyBuf::new(scope, view))
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

            let result = serde_json::from_slice(&bufs[0])
                .map_err(AnyError::from)
                .and_then(|args| op_fn(&mut state.borrow_mut(), args, &mut bufs[1..]));
            let buf = json_serialize_op_result(None, result, state.borrow().get_error_class_fn);
            rv.set(crate::bindings::boxed_slice_to_uint8array(scope, buf).into());
        },
    )
}

fn json_serialize_op_result(
    promise_id: Option<u64>,
    result: Result<serde_json::Value, AnyError>,
    get_error_class_fn: crate::runtime::GetErrorClassFn,
) -> Box<[u8]> {
    let value = match result {
        Ok(v) => serde_json::json!({ "ok": v, "promiseId": promise_id }),
        Err(err) => serde_json::json!({
          "promiseId": promise_id ,
          "err": {
            "className": (get_error_class_fn)(&err),
            "message": err.to_string(),
          }
        }),
    };
    serde_json::to_vec(&value).unwrap().into_boxed_slice()
}
