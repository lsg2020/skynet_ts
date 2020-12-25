// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.

/* eslint-disable @typescript-eslint/no-use-before-define */

((window) => {
  // Available on start due to bindings.
  const core = window.Deno.core;
  const { send } = core;
  const errorMap = {};
  let opsCache = {};

  function dispatch(opName, ...params) {
    return send(opsCache[opName], ...params);
  }

  function registerErrorClass(errorName, className) {
    if (typeof errorMap[errorName] !== "undefined") {
      throw new TypeError(`Error class for "${errorName}" already registered`);
    }
    errorMap[errorName] = className;
  }

  function getErrorClass(errorName) {
    return errorMap[errorName];
  }

  // Returns Uint8Array
  function encodeJson(args) {
    const s = JSON.stringify(args);
    return core.encode(s);
  }

  function decodeJson(ui8) {
    const s = core.decode(ui8);
    return JSON.parse(s);
  }

  function processResponse(res) {
    if ("ok" in res) {
      return res.ok;
    } else {
      const ErrorClass = getErrorClass(res.err.className);
      if (!ErrorClass) {
        throw new Error(
          `Unregistered error class: "${res.err.className}"\n  ${res.err.message}\n  Classes of errors returned from ops should be registered via Deno.core.registerErrorClass().`,
        );
      }
      throw new ErrorClass(res.err.message);
    }
  }

  function jsonOpSync(opName, args = {}, ...zeroCopy) {
    const argsBuf = encodeJson(args);
    const res = dispatch(opName, argsBuf, ...zeroCopy);
    return processResponse(decodeJson(res));
  }

  function rawOpSync(opName, ...params) {
    return dispatch(opName, ...params)
  }

  function ops() {
    // op id 0 is a special value to retrieve the map of registered ops.
    const opsMapBytes = send(0);
    const opsMapJson = String.fromCharCode.apply(null, opsMapBytes);
    opsCache = JSON.parse(opsMapJson);
    //console.log("-----------", JSON.stringify(opsCache, null, 4));
    return { ...opsCache };
  }

  function resources() {
    return jsonOpSync("op_resources");
  }

  function close(rid) {
    jsonOpSync("op_close", { rid });
  }

  Object.assign(window.Deno.core, {
    jsonOpSync,
    rawOpSync,
    ops,
    dispatch: send,
    dispatchByName: dispatch,
    close,
    resources,
    registerErrorClass,
    getErrorClass,
  });
})(this);
