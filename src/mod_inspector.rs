use std::cell::RefCell;
use std::collections::HashMap;
use std::convert::TryFrom;
use std::mem::MaybeUninit;
use std::ops::Deref;
use std::ops::DerefMut;
use std::ptr;
use std::rc::Rc;
use tungstenite::connect;
use url::Url;

use deno_core::error::AnyError;
use deno_core::get_args;
use deno_core::include_js_files;
use deno_core::Extension;
use deno_core::OpState;
use deno_core::ZeroCopyBuf;

use crate::interface;

use rusty_v8 as v8;
use v8::inspector::*;

pub fn init() -> Extension {
    Extension::builder()
        .js(include_js_files!(
          prefix "deno:extensions/v8inspector",
          "01_inspector.js",
        ))
        .ops_ex(vec![
            ("op_v8inspector_message", Box::new(op_v8inspector_message)),
            ("op_v8inspector_connect", Box::new(op_v8inspector_connect)),
            (
                "op_v8inspector_disconnect",
                Box::new(op_v8inspector_disconnect),
            ),
        ])
        .build()
}

pub fn op_v8inspector_connect(
    state: &mut deno_core::JsRuntimeState,
    op_state: Rc<RefCell<OpState>>,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    rv: &mut v8::ReturnValue,
) {
    let proxy_addr = get_args!(scope, v8::Integer, args, 1).value();
    let proxy_ptype = get_args!(scope, v8::Integer, args, 2).value();
    let pause_proxy_addr = get_args!(scope, v8::String, args, 3).to_rust_string_lossy(scope);
    let resume_proxy_addr = get_args!(scope, v8::String, args, 4).to_rust_string_lossy(scope);

    let mut op_state_rc = op_state.borrow_mut();
    let context = op_state_rc.borrow_mut::<crate::SkynetContext>();
    let context = unsafe { &mut **context };

    create_inspector(context, scope, state);
    let inspector = &mut context.inspector.as_mut().unwrap();
    inspector
        .pause_proxy_addr
        .replace(pause_proxy_addr.to_owned());
    inspector
        .resume_proxy_addr
        .replace(resume_proxy_addr.to_owned());

    let session_id = inspector_alloc_session(context);
    let inspector_ptr = inspector_ptr(context);

    let channel = InspectChannel::new(
        inspector_ptr,
        context.skynet,
        proxy_addr,
        proxy_ptype as i32,
        session_id,
    );
    let v8_session = channel.v8_session;
    inspector_add_session(context, session_id, channel, v8_session);

    let v8_session = v8::Integer::new(scope, session_id as i32).into();
    rv.set(v8_session);
}

pub fn op_v8inspector_disconnect(
    state: &mut deno_core::JsRuntimeState,
    op_state: Rc<RefCell<OpState>>,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _rv: &mut v8::ReturnValue,
) {
    let session_id = get_args!(scope, v8::Integer, args, 1).value();

    let mut op_state_rc = op_state.borrow_mut();
    let context = op_state_rc.borrow_mut::<crate::SkynetContext>();
    let context = unsafe { &mut **context };

    create_inspector(context, scope, state);
    inspector_del_session(context, session_id);
}

pub fn op_v8inspector_message(
    state: &mut deno_core::JsRuntimeState,
    op_state: Rc<RefCell<OpState>>,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _rv: &mut v8::ReturnValue,
) {
    let session_id = get_args!(scope, v8::Integer, args, 1).value();
    let msg = v8::Local::<v8::ArrayBufferView>::try_from(args.get(2))
        .map(|view| ZeroCopyBuf::new(scope, view))
        .map_err(|err| {
            let msg = format!("Invalid argument at position {}: {}", 2, err);
            let msg = v8::String::new(scope, &msg).unwrap();
            v8::Exception::type_error(scope, msg)
        });

    let mut op_state_rc = op_state.borrow_mut();
    let context = op_state_rc.borrow_mut::<crate::SkynetContext>();
    let context = unsafe { &mut **context };

    create_inspector(context, scope, state);

    let v8inspector = &mut context.inspector.as_mut().unwrap().v8_sessions;
    if let Some(session) = v8inspector.get_mut(&session_id) {
        let mut buf = Vec::new();
        let b = &msg.unwrap() as &[u8];
        buf.resize(b.len(), 0);
        buf[0..b.len()].copy_from_slice(b);

        unsafe {
            (*(*session)).dispatch_protocol_message(StringView::from(&buf[..]));
        }
    }
}

fn create_inspector(
    context: &mut crate::ContextData,
    scope: &mut v8::HandleScope,
    state: &mut deno_core::JsRuntimeState,
) {
    if context.inspector.is_none() {
        let global = state.global_context.clone().unwrap();
        context.inspector.replace(Inspector::new(scope, global));
    }
}

fn inspector_alloc_session(context: &mut crate::ContextData) -> i64 {
    let inspector = &mut context.inspector.as_mut().unwrap();
    inspector.next_session_id = inspector.next_session_id + 1;
    return inspector.next_session_id;
}

fn inspector_ptr(context: &mut crate::ContextData) -> *mut Inspector {
    let inspector = &mut context.inspector.as_mut().unwrap();
    return inspector.self_ptr;
}

fn inspector_add_session(
    context: &mut crate::ContextData,
    session_id: i64,
    session: Box<dyn v8::inspector::ChannelImpl>,
    v8_session: *mut v8::inspector::V8InspectorSession,
) {
    let inspector = &mut context.inspector.as_mut().unwrap();
    inspector.sessions.insert(session_id, session);
    inspector.v8_sessions.insert(session_id, v8_session);

    let ctx_snjs = unsafe { &mut *(context.ctx as *mut crate::snjs) };
    ctx_snjs.inspector_session_len = inspector.sessions.len();
}

fn inspector_del_session(context: &mut crate::ContextData, session_id: i64) {
    let inspector = &mut context.inspector.as_mut().unwrap();
    inspector.sessions.remove(&session_id);
    inspector.v8_sessions.remove(&session_id);

    let ctx_snjs = unsafe { &mut *(context.ctx as *mut crate::snjs) };
    ctx_snjs.inspector_session_len = inspector.sessions.len();
}

const CONTEXT_GROUP_ID: i32 = 1;
pub struct Inspector {
    base: v8::inspector::V8InspectorClientBase,
    v8_inspector: v8::UniquePtr<v8::inspector::V8Inspector>,
    pub sessions: HashMap<i64, Box<dyn v8::inspector::ChannelImpl>>,
    pub v8_sessions: HashMap<i64, *mut v8::inspector::V8InspectorSession>,
    pub next_session_id: i64,
    pub self_ptr: *mut Inspector,
    pub pause_proxy_addr: Option<String>,
    pub resume_proxy_addr: Option<String>,
}

impl Deref for Inspector {
    type Target = v8::inspector::V8Inspector;
    fn deref(&self) -> &Self::Target {
        self.v8_inspector.as_ref().unwrap()
    }
}

impl DerefMut for Inspector {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.v8_inspector.as_mut().unwrap()
    }
}

pub fn new_box_with<T>(new_fn: impl FnOnce(*mut T) -> T) -> Box<T> {
    let b = Box::new(MaybeUninit::<T>::uninit());
    let p = Box::into_raw(b) as *mut T;
    unsafe { ptr::write(p, new_fn(p)) };
    unsafe { Box::from_raw(p) }
}

impl Inspector {
    pub fn new(scope: &mut v8::HandleScope, context: v8::Global<v8::Context>) -> Box<Self> {
        let context = v8::Local::new(scope, context);
        let scope = &mut v8::ContextScope::new(scope, context);

        let mut self_ = new_box_with(|self_ptr| {
            let v8_inspector_client = v8::inspector::V8InspectorClientBase::new::<Self>();

            Self {
                base: v8_inspector_client,
                v8_inspector: Default::default(),
                sessions: HashMap::new(),
                v8_sessions: HashMap::new(),
                next_session_id: 1,
                self_ptr: self_ptr,
                pause_proxy_addr: None,
                resume_proxy_addr: None,
            }
        });
        self_.v8_inspector = v8::inspector::V8Inspector::create(scope, &mut *self_).into();
        // Tell the inspector about the global context.
        let context = v8::Local::new(scope, context);
        let context_name = v8::inspector::StringView::from(&b"global context"[..]);
        self_.context_created(context, CONTEXT_GROUP_ID, context_name);

        self_
    }
}

impl v8::inspector::V8InspectorClientImpl for Inspector {
    fn base(&self) -> &v8::inspector::V8InspectorClientBase {
        &self.base
    }

    fn base_mut(&mut self) -> &mut v8::inspector::V8InspectorClientBase {
        &mut self.base
    }

    fn run_message_loop_on_pause(&mut self, _context_group_id: i32) {
        if self.pause_proxy_addr.is_none() || self.sessions.len() == 0 {
            return;
        }

        let ws = connect(Url::parse(self.pause_proxy_addr.as_ref().unwrap().as_str()).unwrap());
        if let Err(err) = ws {
            println!(
                "run_message_loop_on_pause can't connect addr:{} err:{}",
                self.pause_proxy_addr.as_ref().unwrap(),
                err
            );
            return;
        }
        let (mut socket, _response) = ws.unwrap();
        loop {
            let msg = socket.read_message();
            if let Err(_) = msg {
                break;
            }

            let msg = msg.unwrap();
            let msg_str = msg.to_text();
            if let Err(_) = msg_str {
                break;
            }
            let msg_str = msg_str.unwrap();
            let session_index = msg_str.find('{');
            if session_index.is_none() {
                break;
            }
            let session_index = session_index.unwrap();

            let session_id = &msg_str[..session_index];
            let session_id = session_id.parse::<i32>().unwrap() as i64;

            if let Some(session) = self.v8_sessions.get_mut(&session_id) {
                unsafe {
                    (**(session)).dispatch_protocol_message(StringView::from(
                        msg_str[session_index..].as_bytes(),
                    ));
                }
            }
        }
    }

    fn quit_message_loop_on_pause(&mut self) {
        if self.resume_proxy_addr.is_none() {
            return;
        }
        let agent = ureq::AgentBuilder::new()
            .timeout_read(std::time::Duration::from_secs(5))
            .timeout_write(std::time::Duration::from_secs(5))
            .build();
        let r = agent
            .get(self.resume_proxy_addr.as_ref().unwrap().as_str())
            .call();
        if let Err(err) = r {
            println!("v8 inspector quit_message_loop_on_pause error:{}", err);
        }
    }

    fn run_if_waiting_for_debugger(&mut self, _context_group_id: i32) {}
}

struct InspectChannel {
    base: v8::inspector::ChannelBase,
    v8_session: *mut v8::inspector::V8InspectorSession,
    skynet: *const std::ffi::c_void,
    proxy_addr: i64,
    proxy_ptype: i32,
    session_id: i64,
}

impl InspectChannel {
    pub fn new(
        inspector_ptr: *mut Inspector,
        skynet: *const std::ffi::c_void,
        proxy_addr: i64,
        proxy_ptype: i32,
        session_id: i64,
    ) -> Box<Self> {
        let self_ = new_box_with(|self_ptr| {
            let v8_channel = v8::inspector::ChannelBase::new::<Self>();
            let v8_session = unsafe { &mut *inspector_ptr }.connect(
                CONTEXT_GROUP_ID,
                unsafe { &mut *self_ptr },
                v8::inspector::StringView::empty(),
            );
            Self {
                base: v8_channel,
                v8_session: v8::UniqueRef::into_raw(v8_session),
                skynet,
                proxy_addr,
                proxy_ptype,
                session_id,
            }
        });

        self_
    }
}

impl Drop for InspectChannel {
    fn drop(&mut self) {
        let v8_session = unsafe { v8::UniqueRef::from_raw(self.v8_session) };
        drop(v8_session);
    }
}

impl v8::inspector::ChannelImpl for InspectChannel {
    fn base(&self) -> &v8::inspector::ChannelBase {
        &self.base
    }
    fn base_mut(&mut self) -> &mut v8::inspector::ChannelBase {
        &mut self.base
    }
    fn send_response(
        &mut self,
        _call_id: i32,
        message: v8::UniquePtr<v8::inspector::StringBuffer>,
    ) {
        let msg = message.unwrap();
        let cmd = match msg.string() {
            StringView::U16(ca) => std::ffi::CString::new(
                self.session_id.to_string() + String::from_utf16_lossy(&*ca).as_str(),
            )
            .unwrap(),
            StringView::U8(ca) => std::ffi::CString::new(
                self.session_id.to_string()
                    + unsafe { String::from_utf8_unchecked((&*ca).to_vec()).as_str() },
            )
            .unwrap(),
        };

        unsafe {
            interface::skynet_send(
                self.skynet,
                0,
                self.proxy_addr as u32,
                self.proxy_ptype,
                0,
                cmd.as_ptr() as *const libc::c_void,
                cmd.to_bytes().len(),
            )
        };
    }
    fn send_notification(&mut self, message: v8::UniquePtr<v8::inspector::StringBuffer>) {
        let msg = message.unwrap();
        let cmd = match msg.string() {
            StringView::U16(ca) => std::ffi::CString::new(
                self.session_id.to_string() + String::from_utf16_lossy(&*ca).as_str(),
            )
            .unwrap(),
            StringView::U8(ca) => std::ffi::CString::new(
                self.session_id.to_string()
                    + unsafe { String::from_utf8_unchecked((&*ca).to_vec()).as_str() },
            )
            .unwrap(),
        };

        unsafe {
            interface::skynet_send(
                self.skynet,
                0,
                self.proxy_addr as u32,
                self.proxy_ptype,
                0,
                cmd.as_ptr() as *const libc::c_void,
                cmd.to_bytes().len(),
            )
        };
    }
    fn flush_protocol_notifications(&mut self) {}
}
