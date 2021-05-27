extern crate libc;

use libc::{c_char, c_int, c_uint, c_void, size_t};

#[repr(C)]
pub struct skynet_socket_message {
    pub msg_type: c_int,
    pub id: c_int,
    pub ud: c_int,
    pub buffer: *const u8,
}
pub const SKYNET_SOCKET_MESSAGE_SIZE: usize = 24;
#[repr(C)]
pub struct socket_sendbuffer {
    pub id: c_int,
    pub msg_type: c_int,
    pub buffer: *const u8,
    pub sz: size_t,
}

#[link(name="skynet")]
extern "C" {
    pub fn skynet_malloc(size: c_uint) -> *mut c_void;
    //pub fn skynet_free(ptr: *const c_void);
    pub fn skynet_send(
        skynet: *const c_void,
        source: c_uint,
        dest: c_uint,
        stype: c_int,
        session: c_int,
        msg: *const c_void,
        size: usize,
    ) -> c_int;
    pub fn skynet_sendname(
        skynet: *const c_void,
        source: c_uint,
        dest: *const c_char,
        stype: c_int,
        session: c_int,
        msg: *const c_void,
        size: usize,
    ) -> c_int;
    pub fn skynet_callback(skynet: *const c_void, ctx: *const c_void, cb: *const c_void);
    pub fn skynet_thread_notify_callback(skynet: *const c_void, ctx: *const c_void, cb: *const c_void);
    pub fn skynet_command(
        skynet: *const c_void,
        cmd: *const c_char,
        parm: *const c_char,
    ) -> *const c_char;
    pub fn skynet_error(skynet: *const c_void, err: *const c_char);
    pub fn skynet_now() -> u64;

    pub fn skynet_socket_connect(skynet: *const c_void, host: *const c_char, port: c_int) -> c_int;
    pub fn skynet_socket_close(skynet: *const c_void, id: c_int) -> c_void;
    pub fn skynet_socket_shutdown(skynet: *const c_void, id: c_int) -> c_void;
    pub fn skynet_socket_udp_address(
        message: *mut skynet_socket_message,
        addrsz: *mut c_int,
    ) -> *const c_char;
    pub fn skynet_socket_bind(skynet: *const c_void, fd: c_int) -> c_int;
    pub fn skynet_socket_start(skynet: *const c_void, id: c_int) -> c_void;
    pub fn skynet_socket_listen(
        skynet: *const c_void,
        host: *const c_char,
        port: c_int,
        backlog: c_int,
    ) -> c_int;
    pub fn skynet_socket_udp(skynet: *const c_void, host: *const c_char, port: c_int) -> c_int;
    pub fn skynet_socket_udp_connect(
        skynet: *const c_void,
        id: c_int,
        host: *const c_char,
        port: c_int,
    ) -> c_void;
    pub fn skynet_socket_sendbuffer(skynet: *const c_void, buffer: *mut socket_sendbuffer)
        -> c_int;
    pub fn skynet_socket_sendbuffer_lowpriority(
        skynet: *const c_void,
        buffer: *mut socket_sendbuffer,
    ) -> c_int;
    pub fn skynet_socket_udp_sendbuffer(
        skynet: *const c_void,
        address: *const c_char,
        buffer: *mut socket_sendbuffer,
    ) -> c_int;
    pub fn skynet_socket_nodelay(skynet: *const c_void, id: c_int) -> c_void;
}
pub const PTYPE_TAG_DONTCOPY: c_int = 0x10000;
pub const PTYPE_TAG_ALLOCSESSION: c_int = 0x20000;

//pub const SKYNET_SOCKET_TYPE_DATA: c_int = 1;
//pub const SKYNET_SOCKET_TYPE_CONNECT: c_int = 2;
//pub const SKYNET_SOCKET_TYPE_CLOSE: c_int = 3;
//pub const SKYNET_SOCKET_TYPE_ACCEPT: c_int = 4;
//pub const SKYNET_SOCKET_TYPE_ERROR: c_int = 5;
pub const SKYNET_SOCKET_TYPE_UDP: c_int = 6;
//pub const SKYNET_SOCKET_TYPE_WARNING: c_int = 7;

pub const PTYPE_DENO_ASYNC: c_int = 234;
