# Deno Node compatibility

This module is meant to have a compatibility layer for the
[NodeJS standard library](https://nodejs.org/docs/latest-v12.x/api/).

**Warning**: Any function of this module should not be referred anywhere in the
deno standard library as it's a compatibility module.

## Supported Builtins

- [x] assert _partly_
- [x] buffer
- [x] child_process _partly_
- [ ] cluster
- [x] console _partly_
- [x] constants _partly_
- [x] crypto _partly_
- [ ] dgram
- [ ] dns
- [x] events
- [x] fs _partly_
- [ ] http
- [ ] http2
- [ ] https
- [x] module
- [ ] net
- [x] os _partly_
- [x] path
- [ ] perf_hooks
- [x] process _partly_
- [x] querystring
- [ ] readline
- [ ] repl
- [x] stream
- [x] string_decoder
- [ ] sys
- [x] timers
- [ ] tls
- [x] tty _partly_
- [x] url
- [x] util _partly_
- ~~v8~~ _can't implement_
- [ ] vm
- [ ] worker_threads
- [ ] zlib

* [x] node globals _partly_

### Deprecated

These builtins are deprecated in NodeJS v13 and will probably not be polyfilled:

- domain
- freelist
- punycode

### Experimental

These builtins are experimental in NodeJS v13 and will not be polyfilled until
they are stable:

- async_hooks
- inspector
- policies
- report
- trace_events
- wasi

## CommonJS Module Loading

`createRequire(...)` is provided to create a `require` function for loading CJS
modules. It also sets supported globals.

```ts
import { createRequire } from "https://deno.land/std@$STD_VERSION/node/module";

const require = createRequire(import.meta.url);
// Loads native module polyfill.
const path = require("path");
// Loads extensionless module.
const cjsModule = require("./my_mod");
// Visits node_modules.
const leftPad = require("left-pad");
```

## Contributing

### Setting up the test runner

This library contains automated tests pulled directly from the Node repo in
order ensure compatibility.

Setting up the test runner is as simple as running the `node/_tools/setup.ts`
file, this will pull the configured tests in and then add them to the test
workflow.

To enable new tests, simply add a new entry inside `node/_tools/config.json`
under the `tests` property. The structure this entries must have has to resemble
a path inside `https://github.com/nodejs/node/tree/master/test`.

### Best practices

When converting from promise-based to callback-based APIs, the most obvious way
is like this:

```ts
promise.then((value) => callback(null, value)).catch(callback);
```

This has a subtle bug - if the callback throws an error, the catch statement
will also catch _that_ error, and the callback will be called twice. The correct
way to do it is like this:

```ts
promise.then((value) => callback(null, value), callback);
```

The second parameter of `then` can also be used to catch errors, but only errors
from the existing promise, not the new one created by the callback.

If the Deno equivalent is actually synchronous, there's a similar problem with
try/catch statements:

```ts
try {
  const value = process();
  callback(null, value);
} catch (err) {
  callback(err);
}
```

Since the callback is called within the `try` block, any errors from it will be
caught and call the callback again.

The correct way to do it is like this:

```ts
let err, value;
try {
  value = process();
} catch (e) {
  err = e;
}
if (err) {
  callback(err); // Make sure arguments.length === 1
} else {
  callback(null, value);
}
```

It's not as clean, but prevents the callback being called twice.
