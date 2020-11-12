// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.

((window) => {
  const core = window.Deno.core;

  function loadavg() {
    return core.jsonOpSync("op_loadavg");
  }

  function hostname() {
    return core.jsonOpSync("op_hostname");
  }

  function osRelease() {
    return core.jsonOpSync("op_os_release");
  }

  function systemMemoryInfo() {
    return core.jsonOpSync("op_system_memory_info");
  }

  function v8MemoryInfo() {
    let ret = core.rawOpSync("op_v8_memory_info");
    let s = JSON.parse(core.decode(ret));
    return s;
  }

  function exit(code = 0) {
    core.jsonOpSync("op_exit", { code });
    throw new Error("Code not reachable");
  }

  function setEnv(key, value) {
    core.jsonOpSync("op_set_env", { key, value });
  }

  function getEnv(key) {
    return core.jsonOpSync("op_get_env", { key })[0];
  }

  function deleteEnv(key) {
    core.jsonOpSync("op_delete_env", { key });
  }

  function exists_file(path) {
    return core.jsonOpSync("op_file_exists", {path: path});
  }

  const env = {
    get: getEnv,
    toObject() {
      return core.jsonOpSync("op_env");
    },
    set: setEnv,
    delete: deleteEnv,
  };

  function execPath() {
    return core.jsonOpSync("op_exec_path");
  }

  window.__bootstrap.os = {
    env,
    execPath,
    exit,
    osRelease,
    systemMemoryInfo,
    v8MemoryInfo,
    hostname,
    loadavg,
    exists_file,
  };
})(this);
