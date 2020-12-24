((window) => {
  const core = window.Deno.core;

  function new_ctx() {
    return core.rawOpSync("op_tls_new_ctx");
  }

  function free_ctx(ctx) {
      core.rawOpSync("op_tls_free_ctx", ctx);
  }

  function set_cert(ctx, certfile, keyfile) {
    core.rawOpSync("op_tls_set_cert", ctx, certfile, keyfile);
  }

  function new_tls(ctx, method) {
    return core.rawOpSync("op_tls_new_tls", ctx, method);
  }

  function free_tls(ctx) {
    core.rawOpSync("op_tls_free_tls", ctx);
  }

  function finished(ctx) {
    return core.rawOpSync("op_tls_finished", ctx);
  }
  
  function handshake(ctx) {
    return core.rawOpSync("op_tls_handshake", ctx);
  }

  function bio_write(ctx, ...buffer) {
    return core.rawOpSync("op_tls_bio_write", ctx, ...buffer);
  }

  function bio_read(ctx, buffer, offset) {
    return core.rawOpSync("op_tls_bio_read", ctx, buffer, offset);
  }

  function ssl_write(ctx, ...buffer) {
    return core.rawOpSync("op_tls_ssl_write", ctx, ...buffer);
  }

  function ssl_read(ctx, buffer, offset, sz) {
    return core.rawOpSync("op_tls_ssl_read", ctx, buffer, offset, sz);
  }

  window.__bootstrap.tls = {
    new_ctx,
    free_ctx,
    set_cert,
    new_tls,
    free_tls,
    finished,
    handshake,
    bio_write,
    bio_read,
    ssl_write,
    ssl_read,
  };
})(this);
