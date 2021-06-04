## JSON decode
* [lua json](https://github.com/lsg2020/skynet_ts_demo/blob/demo/service/benchmarks/json_lua.lua) decode result  amount: 100000          ms:2400
* [cjson.so](https://github.com/lsg2020/skynet_ts_demo/blob/demo/service/benchmarks/json_lua.lua) decode result     amount: 100000          ms:310
* [JS](https://github.com/lsg2020/skynet_ts_demo/blob/demo/demo/service/benchmarks/pure_js_json.ts) decode result   amount:100000           ms:679
* [V8](https://github.com/lsg2020/skynet_ts_demo/blob/demo/demo/service/benchmarks/v8_json.ts) decode result   amount:100000           ms:160

## [Munchausen_numbers test](http://rosettacode.org/wiki/Munchausen_numbers)
* [lua](https://github.com/lsg2020/skynet_ts_demo/blob/demo/service/benchmarks/munchausen.lua) munchausen result:2         amount: 5000000         ms:2740
* [JS](https://github.com/lsg2020/skynet_ts_demo/blob/demo/demo/service/benchmarks/munchausen.ts) munchausen result:2  amount:5000000          ms:2200

## [hash tables test](https://gist.github.com/spion/3049314)
* [lua](https://github.com/lsg2020/skynet_ts_demo/blob/demo/service/benchmarks/hash_table.lua) hash table result   amount: 10000000                ms:4590
* [JS](https://github.com/lsg2020/skynet_ts_demo/blob/demo/demo/service/benchmarks/hash_table.ts) hash table test      amount:10000000         ms:127

## md5
* [md5.so](https://github.com/lsg2020/skynet_ts_demo/blob/demo/service/benchmarks/md5_luac.lua) result       amount: 1000000         ms:540
* [JS](https://github.com/lsg2020/skynet_ts_demo/blob/demo/demo/service/benchmarks/md5.ts) result     amount:1000000          ms:734


## http server
* [snjs deno.http服务](https://github.com/lsg2020/skynet_ts_demo/blob/demo/demo/service/benchmarks/http.ts)
    * [wrk测试](https://github.com/wg/wrk)
```
lsg@lsg:~/wrk$ ./wrk --latency -c 100 -t 8 -d 30 http://127.0.0.1:4500
Running 30s test @ http://127.0.0.1:4500
  8 threads and 100 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency     1.86ms    2.28ms 142.06ms   99.41%
    Req/Sec     6.73k   519.30     9.48k    86.08%
  Latency Distribution
     50%    1.71ms
     75%    1.81ms
     90%    1.99ms
     99%    3.27ms
  1610505 requests in 30.06s, 133.62MB read
Requests/sec:  53571.73
Transfer/sec:      4.44MB
```

* [原生deno](https://github.com/lsg2020/skynet_ts_demo/blob/demo/demo/service/benchmarks/deno_http.ts)
    * `deno run --allow-all --unstable demo/service/benchmarks/deno_http.ts`
    * [wrk测试](https://github.com/wg/wrk)
```
lsg@lsg:~/wrk$ ./wrk --latency -c 100 -t 8 -d 30 http://127.0.0.1:4500
Running 30s test @ http://127.0.0.1:4500
  8 threads and 100 connections
  Thread Stats   Avg      Stdev     Max   +/- Stdev
    Latency     2.68ms    6.57ms 217.00ms   99.11%
    Req/Sec     5.38k   501.66    10.79k    93.11%
  Latency Distribution
     50%    2.20ms
     75%    2.32ms
     90%    2.47ms
     99%    7.50ms
  1282849 requests in 30.09s, 106.44MB read
Requests/sec:  42637.85
Transfer/sec:      3.54MB
```

## [lua消息测试](https://github.com/lsg2020/skynet_ts_demo/blob/demo/demo/service/benchmarks/lua_msg.ts)
* snlua服务: `lua msg per sec:        370635`
* snjs服务: `js msg per sec: 384704`
