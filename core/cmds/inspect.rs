use crate::error::AnyError;
use crate::inspector::*;
use crate::JsRuntime;
use crate::JsRuntimeState;
use crate::OpState;
use std::cell::RefCell;
use std::convert::TryFrom;
use std::rc::Rc;
use std::string::String;

use rusty_v8 as v8;
use v8::inspector::*;

pub fn init(rt: &mut JsRuntime) {
    rt.register_op("op_v8inspector_connect", op_v8inspector_connect);
    rt.register_op("op_v8inspector_disconnect", op_v8inspector_disconnect);
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
    fn send_response(&mut self, _call_id: i32, message: v8::UniquePtr<v8::inspector::StringBuffer>) {
        let msg = message.unwrap();
        let cmd = match msg.string() {
            StringView::U16(ca) => std::ffi::CString::new(
                self.session_id.to_string() + String::from_utf16_lossy(&*ca).as_str(),
            )
            .unwrap(),
            StringView::U8(ca) => std::ffi::CString::new(
                self.session_id.to_string() + unsafe{ String::from_utf8_unchecked((&*ca).to_vec()).as_str() },
            )
            .unwrap(),
        };

        unsafe {
            crate::skynet_send(
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
                self.session_id.to_string() + unsafe{ String::from_utf8_unchecked((&*ca).to_vec()).as_str() },
            )
            .unwrap(),
        };

        unsafe {
            crate::skynet_send(
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

pub fn op_v8inspector_connect(
    state: Rc<RefCell<OpState>>,
    s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let state = &mut state.borrow_mut();

    let proxy_addr = crate::get_args!(scope, v8::Integer, args, 1).value();
    let proxy_ptype = crate::get_args!(scope, v8::Integer, args, 2).value();
    let pause_proxy_addr = crate::get_args!(scope, v8::String, args, 3).to_rust_string_lossy(scope);
    let resume_proxy_addr = crate::get_args!(scope, v8::String, args, 4).to_rust_string_lossy(scope);


    s.create_inspector(scope);
    s.set_pause_resume_proxy(pause_proxy_addr.as_str(), resume_proxy_addr.as_str());

    let skynet = state.skynet;
    let session_id = s.inspector_alloc_session();
    let inspector_ptr = s.inspector_ptr();
    let channel = InspectChannel::new(
        inspector_ptr,
        skynet,
        proxy_addr,
        proxy_ptype as i32,
        session_id,
    );
    let v8_session = channel.v8_session;
    s.inspector_add_session(session_id, channel, v8_session);

    let v8_session = v8::Integer::new(scope, session_id as i32).into();
    rv.set(v8_session);
}

pub fn op_v8inspector_disconnect(
    _state: Rc<RefCell<OpState>>,
    s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _rv: v8::ReturnValue,
) {
    let session_id = crate::get_args!(scope, v8::Integer, args, 1).value();

    s.create_inspector(scope);
    s.inspector_del_session(session_id);
}
