use crate::error::AnyError;
use crate::JsRuntime;
use crate::JsRuntimeState;
use crate::OpState;
use crate::ZeroCopyBuf;
use crate::BufVec;
use std::cell::RefCell;
use std::rc::Rc;
use rusty_v8 as v8;
use openssl_sys::*;
use std::convert::TryFrom;

const BIO_C_SET_BUF_MEM_EOF_RETURN: libc::c_int = 130;

struct SslCtx {
    pub ctx: *mut SSL_CTX,
}

struct TlsContext {
    ssl: *mut SSL,
    in_bio: *mut BIO,
    out_bio: *mut BIO,
    is_server: bool,
    is_close: bool,
    handshake: bool,
}

pub fn init(rt: &mut JsRuntime) {
    rt.register_op("op_tls_new_ctx", op_tls_new_ctx);
    rt.register_op("op_tls_free_ctx", op_tls_free_ctx);
    rt.register_op("op_tls_set_cert", op_tls_set_cert);
    rt.register_op("op_tls_new_tls", op_tls_new_tls);
    rt.register_op("op_tls_free_tls", op_tls_free_tls);
    rt.register_op("op_tls_finished", op_tls_finished);
    rt.register_op("op_tls_handshake", op_tls_handshake);
    rt.register_op("op_tls_bio_write", op_tls_bio_write);
    rt.register_op("op_tls_bio_read", op_tls_bio_read);
    rt.register_op("op_tls_ssl_write", op_tls_ssl_write);
    rt.register_op("op_tls_ssl_read", op_tls_ssl_read);
}

#[macro_export]
macro_rules! throw_error {
    ($scope: expr, $msg: expr) => {
        {
            let msg = v8::String::new($scope, &$msg).unwrap();
            let exc = v8::Exception::type_error($scope, msg);
            $scope.throw_exception(exc);
        }
    };
}

#[macro_export]
macro_rules! bio_pending {
    ($bio: expr) => {
        {
            let r = unsafe { BIO_ctrl($bio, 10, 0, std::ptr::null_mut()) };
            r    
        }
    };    
}

pub fn op_tls_new_ctx(
    _state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    _args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let ctx = unsafe { SSL_CTX_new(TLS_method()) };
    if ctx == std::ptr::null_mut() {
        let err = unsafe { ERR_get_error() };
        return throw_error!(scope, format!("SSL_CTX_new client faild. {}", err));
    }
    let ctx = Box::new(SslCtx {
        ctx: ctx,
    });
    
    let v8_ctx = v8::BigInt::new_from_u64(scope, Box::into_raw(ctx) as u64).into();
    rv.set(v8_ctx);
}

pub fn op_tls_free_ctx(
    _state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _rv: v8::ReturnValue,
) {
    let ctx = crate::get_args!(scope, v8::BigInt, args, 1).u64_value().0;
    let ctx = unsafe { Box::from_raw(ctx as *mut SslCtx) };
    unsafe { SSL_CTX_free(ctx.ctx) };
}

pub fn op_tls_set_cert(
    _state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _rv: v8::ReturnValue,
) {
    let ctx = crate::get_args!(scope, v8::BigInt, args, 1).u64_value().0;
    let certfile = crate::get_args!(scope, v8::String, args, 2).to_rust_string_lossy(scope);
    let keyfile = crate::get_args!(scope, v8::String, args, 3).to_rust_string_lossy(scope);

    let ctx = unsafe { &mut *(ctx as *mut SslCtx) };
    
    let certfile = std::ffi::CString::new(certfile).unwrap();
    let mut ret = unsafe { SSL_CTX_use_certificate_chain_file(ctx.ctx, certfile.as_ptr()) };
    if ret != 1 {
        return throw_error!(scope, format!("SSL_CTX_use_certificate_chain_file error: {}", ret));
    }

    let keyfile = std::ffi::CString::new(keyfile).unwrap();
    ret = unsafe { SSL_CTX_use_PrivateKey_file(ctx.ctx, keyfile.as_ptr(), SSL_FILETYPE_PEM) };
    if ret != 1 {
        return throw_error!(scope, format!("SSL_CTX_use_PrivateKey_file error: {}", ret));
    }

    ret = unsafe { SSL_CTX_check_private_key(ctx.ctx) };
    if ret != 1 {
        return throw_error!(scope, format!("SSL_CTX_check_private_key error: {}", ret));
    }
}

fn _init_bio(scope: &mut v8::HandleScope, tls_p: &mut TlsContext, ctx_p: &mut SslCtx) -> bool {
    tls_p.ssl = unsafe { SSL_new(ctx_p.ctx) };
    if tls_p.ssl == std::ptr::null_mut() {
        throw_error!(scope, "SSL_new faild");
        return false;
    }

    tls_p.in_bio = unsafe { BIO_new(BIO_s_mem()) };
    if tls_p.in_bio == std::ptr::null_mut() {
        throw_error!(scope, "new in bio faild");
        return false;
    }
    unsafe { BIO_ctrl(tls_p.in_bio, BIO_C_SET_BUF_MEM_EOF_RETURN, -1, std::ptr::null_mut()) };/* see: https://www.openssl.org/docs/crypto/BIO_s_mem.html */

    tls_p.out_bio = unsafe { BIO_new(BIO_s_mem()) };
    if tls_p.out_bio == std::ptr::null_mut() {
        throw_error!(scope, "new out bio faild");
        return false;
    }
    unsafe { BIO_ctrl(tls_p.out_bio, BIO_C_SET_BUF_MEM_EOF_RETURN, -1, std::ptr::null_mut()) };/* see: https://www.openssl.org/docs/crypto/BIO_s_mem.html */

    unsafe { SSL_set_bio(tls_p.ssl, tls_p.in_bio, tls_p.out_bio) };
    return true;
}

pub fn op_tls_new_tls(
    _state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let ctx = crate::get_args!(scope, v8::BigInt, args, 1).u64_value().0;
    let method = crate::get_args!(scope, v8::String, args, 2).to_rust_string_lossy(scope);
    let ctx = unsafe { &mut *(ctx as *mut SslCtx) };

    let mut tls_p = Box::new(TlsContext {
        ssl: std::ptr::null_mut(),
        in_bio: std::ptr::null_mut(),
        out_bio: std::ptr::null_mut(),
        is_server: false,
        is_close: false,
        handshake: false,
    });
    
    if method == "server" {
        tls_p.is_server = true;
        if !_init_bio(scope, tls_p.as_mut(), ctx) {
            return;
        }

        unsafe { SSL_set_accept_state(tls_p.ssl) };
    } else if method == "client" {
        tls_p.is_server = false;
        if !_init_bio(scope, tls_p.as_mut(), ctx) {
            return;
        }

        unsafe { SSL_set_connect_state(tls_p.ssl) };
    } else {
        return throw_error!(scope, format!("invalid method: {} e.g[server, client]", method));
    }

    let v8_ctx = v8::BigInt::new_from_u64(scope, Box::into_raw(tls_p) as u64).into();
    rv.set(v8_ctx);
}

pub fn op_tls_free_tls(
    _state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    _rv: v8::ReturnValue,
) {
    let tls_p = crate::get_args!(scope, v8::BigInt, args, 1).u64_value().0;
    let mut tls_p = unsafe { Box::from_raw(tls_p as *mut TlsContext) };
    if !tls_p.is_close {
        unsafe { SSL_free(tls_p.ssl) };
        tls_p.ssl = std::ptr::null_mut();
        tls_p.in_bio = std::ptr::null_mut();
        tls_p.out_bio = std::ptr::null_mut();
        tls_p.is_close = true;
    }
}

pub fn op_tls_finished(
    _state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let tls_p = crate::get_args!(scope, v8::BigInt, args, 1).u64_value().0;
    let mut tls_p = unsafe { &mut *(tls_p as *mut TlsContext) };
    if tls_p.is_close {
        return throw_error!(scope, "context is closed");
    }

    let b = unsafe { SSL_is_init_finished(tls_p.ssl) } == 1;
    tls_p.handshake = b;
    rv.set(v8::Boolean::new(scope, b).into());
}

pub fn op_tls_handshake(
    _state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let tls_p = crate::get_args!(scope, v8::BigInt, args, 1).u64_value().0;    
    let tls_p = unsafe { &mut *(tls_p as *mut TlsContext) };
    if tls_p.is_close {
        return throw_error!(scope, "context is closed");
    }
    if unsafe { SSL_is_init_finished(tls_p.ssl) } == 1 {
        return throw_error!(scope, "handshake is finished");
    }

    let ret = unsafe { SSL_do_handshake(tls_p.ssl) };
    if ret == 1 {
        return;
    }

    let err = unsafe { SSL_get_error(tls_p.ssl, ret) };
    if ret >= 0 {
        return throw_error!(scope, format!("SSL_do_handshake error:{} ret:{}", err, ret));
    }

    if err == SSL_ERROR_WANT_READ || err == SSL_ERROR_WANT_WRITE {
        rv.set(v8::Integer::new(scope, bio_pending!(tls_p.out_bio) as i32).into());
        return;
    }

    return throw_error!(scope, format!("SSL_do_handshake error:{} ret:{}", err, ret));
}

pub fn op_tls_bio_write(
    _state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let tls_p = crate::get_args!(scope, v8::BigInt, args, 1).u64_value().0;
    let tls_p = unsafe { &mut *(tls_p as *mut TlsContext) };
    if tls_p.is_close {
        return throw_error!(scope, "context is closed");
    }

    let buf_iter = (2..args.length()).map(|idx| {
        v8::Local::<v8::ArrayBufferView>::try_from(args.get(idx))
            .map(|view| ZeroCopyBuf::new(scope, view))
            .map_err(|err| {
                let msg = format!("Invalid argument at position {}: {}", idx, err);
                let msg = v8::String::new(scope, &msg).unwrap();
                v8::Exception::type_error(scope, msg)
            })
    });

    let bufs: BufVec = match buf_iter.collect::<Result<_, _>>() {
        Ok(bufs) => bufs,
        Err(exc) => {
            scope.throw_exception(exc);
            return;
        }
    };

    for buf in bufs {
        let mut ptr = (&buf as &[u8]).as_ptr() as usize;
        let mut sz = buf.len() as i32;
        while sz > 0 {
            let written = unsafe { BIO_write(tls_p.in_bio, ptr as *const libc::c_void, sz) };
            if written <= 0 {
                return throw_error!(scope, format!("BIO_write error:{}", written));
            } else if written <= sz {
                ptr += written as usize;
                sz -= written;
            } else {
                return throw_error!(scope, format!("invalid BIO_write:{}", written));
            }
        }
    }
    
    let pending_sz = if tls_p.handshake {
        unsafe { SSL_read(tls_p.ssl, std::ptr::null_mut(), 0) };
        unsafe { SSL_pending(tls_p.ssl) }
    } else {
        0
    };
    let v8_sz = v8::Integer::new(scope, pending_sz).into();
    rv.set(v8_sz);
}

pub fn op_tls_bio_read(
    _state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let tls_p = crate::get_args!(scope, v8::BigInt, args, 1).u64_value().0;    
    let tls_p = unsafe { &mut *(tls_p as *mut TlsContext) };
    if tls_p.is_close {
        return throw_error!(scope, "context is closed");
    }

    let buffer = crate::get_args!(scope, v8::ArrayBuffer, args, 2);
    let buffer = v8::ArrayBuffer::get_backing_store(&buffer);
    let offset = crate::get_args!(scope, v8::Integer, args, 3).value() as libc::size_t;

    let mut sz = (buffer.byte_length() - offset) as i32;
    if sz <= 0 {
        return throw_error!(scope, format!("invalid buffer:{}", sz));
    }

    let buf = unsafe { crate::bindings::get_backing_store_slice_mut(&buffer, offset, sz as usize) };
    let mut buf = buf.as_ptr() as usize;

    let mut pending = bio_pending!(tls_p.out_bio);
    while pending > 0 && sz > 0 {
        let read = unsafe { BIO_read(tls_p.out_bio, buf as *mut libc::c_void, sz) };
        if read <= 0 {
            return throw_error!(scope, format!("BIO_read error:{}", read));
        } else if read <= sz {
            buf += read as usize;
            sz -= read;
        } else {
            return throw_error!(scope, format!("invalid BIO_read:{}", read));
        }
        pending = bio_pending!(tls_p.out_bio);
    }

    let v8_sz = v8::Integer::new(scope, (buffer.byte_length() - offset - sz as usize) as i32).into();
    rv.set(v8_sz);
}

pub fn op_tls_ssl_write(
    _state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let tls_p = crate::get_args!(scope, v8::BigInt, args, 1).u64_value().0;    
    let tls_p = unsafe { &mut *(tls_p as *mut TlsContext) };
    if tls_p.is_close {
        return throw_error!(scope, "context is closed");
    }

    let buf_iter = (2..args.length()).map(|idx| {
        v8::Local::<v8::ArrayBufferView>::try_from(args.get(idx))
            .map(|view| ZeroCopyBuf::new(scope, view))
            .map_err(|err| {
                let msg = format!("Invalid argument at position {}: {}", idx, err);
                let msg = v8::String::new(scope, &msg).unwrap();
                v8::Exception::type_error(scope, msg)
            })
    });

    let bufs: BufVec = match buf_iter.collect::<Result<_, _>>() {
        Ok(bufs) => bufs,
        Err(exc) => {
            scope.throw_exception(exc);
            return;
        }
    };

    for buf in bufs {
        let mut ptr = (&buf as &[u8]).as_ptr() as usize;
        let mut sz = buf.len() as i32;
        while sz > 0 {
            let written = unsafe { SSL_write(tls_p.ssl, ptr as *const libc::c_void, sz) };
            if written <= 0 {
                let err = unsafe { SSL_get_error(tls_p.ssl, written) };
                return throw_error!(scope, format!("SSL_write error:{}", err));
            } else if written <= sz {
                ptr += written as usize;
                sz -= written;
            } else {
                return throw_error!(scope, format!("invalid SSL_write:{}", written));
            }
        }
    }
    
    let pending_sz = bio_pending!(tls_p.out_bio);
    let v8_sz = v8::Integer::new(scope, pending_sz as i32).into();
    rv.set(v8_sz);
}

pub fn op_tls_ssl_read(
    _state: Rc<RefCell<OpState>>,
    _s: &mut JsRuntimeState,
    scope: &mut v8::HandleScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let tls_p = crate::get_args!(scope, v8::BigInt, args, 1).u64_value().0;
    let tls_p = unsafe { &mut *(tls_p as *mut TlsContext) };
    if tls_p.is_close {
        return throw_error!(scope, "context is closed");
    }

    let buffer = crate::get_args!(scope, v8::ArrayBuffer, args, 2);
    let buffer = v8::ArrayBuffer::get_backing_store(&buffer);
    let offset = crate::get_args!(scope, v8::Integer, args, 3).value() as libc::size_t;
    let mut recv_sz = crate::get_args!(scope, v8::Integer, args, 4).value() as i32;

    let mut sz = (buffer.byte_length() - offset) as i32;
    if sz <= 0 {
        return throw_error!(scope, format!("invalid buffer:{}", sz));
    }

    let buf = unsafe { crate::bindings::get_backing_store_slice_mut(&buffer, offset, sz as usize) };
    let mut buf = buf.as_ptr() as usize;

    while sz > 0 && recv_sz > 0 {
        let read_sz = if sz > recv_sz { recv_sz } else { sz };
        let read = unsafe { SSL_read(tls_p.ssl, buf as *mut libc::c_void, read_sz) };
        if read <= 0 {
            let err = unsafe { SSL_get_error(tls_p.ssl, read) };
            if err == SSL_ERROR_WANT_READ || err == SSL_ERROR_WANT_WRITE {
                break;
            }
            return throw_error!(scope, format!("SSL_read error:{}", err));
        } else if read <= sz {
            buf += read as usize;
            sz -= read;
            recv_sz -= read;
        } else {
            return throw_error!(scope, format!("invalid SSL_read:{}", read));
        }
        // pending = unsafe { SSL_pending(tls_p.ssl) };
    }

    let v8_sz = v8::Integer::new(scope, (buffer.byte_length() - offset - sz as usize) as i32).into();
    let v8_pending = v8::Integer::new(scope, unsafe { SSL_pending(tls_p.ssl) }).into();
    let v8_ret = v8::Array::new(scope, 2);
    v8_ret.set_index(scope, 0, v8_sz);
    v8_ret.set_index(scope, 1, v8_pending);
    rv.set(v8_ret.into());
}
