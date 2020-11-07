// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.

((window) => {
  // Some of the code here is adapted directly from V8 and licensed under a BSD
  // style license available here: https://github.com/v8/v8/blob/24886f2d1c565287d33d71e4109a53bf0b54b75c/LICENSE.v8
  const core = window.Deno.core;
  const assert = window.__bootstrap.util.assert;
  const internals = window.__bootstrap.internals;

  function opFormatDiagnostics(diagnostics) {
    return core.jsonOpSync("op_format_diagnostic", diagnostics);
  }

  function opApplySourceMap(location) {
    const res = core.jsonOpSync("op_apply_source_map", location);
    return {
      fileName: res.fileName,
      lineNumber: res.lineNumber,
      columnNumber: res.columnNumber,
    };
  }

  function patchCallSite(callSite, location) {
    return {
      getThis() {
        return callSite.getThis();
      },
      getTypeName() {
        return callSite.getTypeName();
      },
      getFunction() {
        return callSite.getFunction();
      },
      getFunctionName() {
        return callSite.getFunctionName();
      },
      getMethodName() {
        return callSite.getMethodName();
      },
      getFileName() {
        return location.fileName;
      },
      getLineNumber() {
        return location.lineNumber;
      },
      getColumnNumber() {
        return location.columnNumber;
      },
      getEvalOrigin() {
        return callSite.getEvalOrigin();
      },
      isToplevel() {
        return callSite.isToplevel();
      },
      isEval() {
        return callSite.isEval();
      },
      isNative() {
        return callSite.isNative();
      },
      isConstructor() {
        return callSite.isConstructor();
      },
      isAsync() {
        return callSite.isAsync();
      },
      isPromiseAll() {
        return callSite.isPromiseAll();
      },
      getPromiseIndex() {
        return callSite.getPromiseIndex();
      },
    };
  }

  // Keep in sync with `cli/fmt_errors.rs`.
  function formatLocation(callSite) {
    if (callSite.isNative()) {
      return "native";
    }

    let result = "";

    const fileName = callSite.getFileName();

    if (fileName) {
      result += fileName;
    } else {
      if (callSite.isEval()) {
        const evalOrigin = callSite.getEvalOrigin();
        assert(evalOrigin != null);
        result += `${evalOrigin}, `;
      }
      result += "<anonymous>";
    }

    const lineNumber = callSite.getLineNumber();
    if (lineNumber != null) {
      result += `:${lineNumber}`;

      const columnNumber = callSite.getColumnNumber();
      if (columnNumber != null) {
        result += `:${columnNumber}`;
      }
    }

    return result;
  }

  // Keep in sync with `cli/fmt_errors.rs`.
  function formatCallSite(callSite) {
    let result = "";
    const functionName = callSite.getFunctionName();

    const isTopLevel = callSite.isToplevel();
    const isAsync = callSite.isAsync();
    const isPromiseAll = callSite.isPromiseAll();
    const isConstructor = callSite.isConstructor();
    const isMethodCall = !(isTopLevel || isConstructor);

    if (isAsync) {
      result += "async ";
    }
    if (isPromiseAll) {
      result += `Promise.all (index ${callSite.getPromiseIndex()})`;
      return result;
    }
    if (isMethodCall) {
      const typeName = callSite.getTypeName();
      const methodName = callSite.getMethodName();

      if (functionName) {
        if (typeName) {
          if (!functionName.startsWith(typeName)) {
            result += `${typeName}.`;
          }
        }
        result += functionName;
        if (methodName) {
          if (!functionName.endsWith(methodName)) {
            result += ` [as ${methodName}]`;
          }
        }
      } else {
        if (typeName) {
          result += `${typeName}.`;
        }
        if (methodName) {
          result += methodName;
        } else {
          result += "<anonymous>";
        }
      }
    } else if (isConstructor) {
      result += "new ";
      if (functionName) {
        result += functionName;
      } else {
        result += "<anonymous>";
      }
    } else if (functionName) {
      result += functionName;
    } else {
      result += formatLocation(callSite);
      return result;
    }

    result += ` (${formatLocation(callSite)})`;
    return result;
  }

  function evaluateCallSite(callSite) {
    return {
      this: callSite.getThis(),
      typeName: callSite.getTypeName(),
      function: callSite.getFunction(),
      functionName: callSite.getFunctionName(),
      methodName: callSite.getMethodName(),
      fileName: callSite.getFileName(),
      lineNumber: callSite.getLineNumber(),
      columnNumber: callSite.getColumnNumber(),
      evalOrigin: callSite.getEvalOrigin(),
      isToplevel: callSite.isToplevel(),
      isEval: callSite.isEval(),
      isNative: callSite.isNative(),
      isConstructor: callSite.isConstructor(),
      isAsync: callSite.isAsync(),
      isPromiseAll: callSite.isPromiseAll(),
      promiseIndex: callSite.getPromiseIndex(),
    };
  }

  function prepareStackTrace(
    error,
    callSites,
  ) {
    const mappedCallSites = callSites.map(
      (callSite) => {
        const fileName = callSite.getFileName();
        const lineNumber = callSite.getLineNumber();
        const columnNumber = callSite.getColumnNumber();
        if (fileName && lineNumber != null && columnNumber != null) {
          return patchCallSite(
            callSite,
            opApplySourceMap({
              fileName,
              lineNumber,
              columnNumber,
            }),
          );
        }
        return callSite;
      },
    );
    Object.defineProperties(error, {
      __callSiteEvals: { value: [], configurable: true },
    });
    const formattedCallSites = [];
    for (const callSite of mappedCallSites) {
      error.__callSiteEvals.push(Object.freeze(evaluateCallSite(callSite)));
      formattedCallSites.push(formatCallSite(callSite));
    }
    Object.freeze(error.__callSiteEvals);
    const message = error.message !== undefined ? error.message : "";
    const name = error.name !== undefined ? error.name : "Error";
    let messageLine;
    if (name != "" && message != "") {
      messageLine = `${name}: ${message}`;
    } else if ((name || message) != "") {
      messageLine = name || message;
    } else {
      messageLine = "";
    }
    return messageLine +
      formattedCallSites.map((s) => `\n    at ${s}`).join("");
  }

  function setPrepareStackTrace(ErrorConstructor) {
    ErrorConstructor.prepareStackTrace = prepareStackTrace;
  }

  internals.exposeForTest("setPrepareStackTrace", setPrepareStackTrace);

  window.__bootstrap.errorStack = {
    setPrepareStackTrace,
    opApplySourceMap,
    opFormatDiagnostics,
  };
})(this);
