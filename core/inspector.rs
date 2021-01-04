use std::collections::HashMap;
use std::mem::MaybeUninit;
use std::ops::Deref;
use std::ops::DerefMut;
use std::ptr;
use tungstenite::{connect};
use url::Url;

use rusty_v8 as v8;
use v8::inspector::*;

pub const CONTEXT_GROUP_ID: i32 = 1;
pub struct Inspector {
    base: v8::inspector::V8InspectorClientBase,
    v8_inspector: v8::UniqueRef<v8::inspector::V8Inspector>,
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
        &self.v8_inspector
    }
}

impl DerefMut for Inspector {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.v8_inspector
    }
}

impl Inspector {
    pub fn new(scope: &mut v8::HandleScope, context: v8::Global<v8::Context>) -> Box<Self> {
        let context = v8::Local::new(scope, context);
        let scope = &mut v8::ContextScope::new(scope, context);

        let self_ = new_box_with(|self_ptr| {
            let v8_inspector_client = v8::inspector::V8InspectorClientBase::new::<Self>();
            let mut v8_inspector =
                v8::inspector::V8Inspector::create(scope, unsafe { &mut *self_ptr });

            let name = b"global_context";
            let name_view = StringView::from(&name[..]);
            v8_inspector.context_created(context, CONTEXT_GROUP_ID, name_view);

            Self {
                base: v8_inspector_client,
                v8_inspector,
                sessions: HashMap::new(),
                v8_sessions: HashMap::new(),
                next_session_id: 1,
                self_ptr: self_ptr,
                pause_proxy_addr: None,
                resume_proxy_addr: None,
            }
        });

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
        // let r = reqwest::blocking::get(self.resume_proxy_addr.as_ref().unwrap().as_str());
        let client = reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(5)).build().unwrap();
        let r = client.get(self.resume_proxy_addr.as_ref().unwrap().as_str()).send();
        if let Err(err) = r {
            println!("v8 inspector quit_message_loop_on_pause error:{}", err);
        }
    }

    fn run_if_waiting_for_debugger(&mut self, _context_group_id: i32) {}
}

pub fn new_box_with<T>(new_fn: impl FnOnce(*mut T) -> T) -> Box<T> {
    let b = Box::new(MaybeUninit::<T>::uninit());
    let p = Box::into_raw(b) as *mut T;
    unsafe { ptr::write(p, new_fn(p)) };
    unsafe { Box::from_raw(p) }
}
