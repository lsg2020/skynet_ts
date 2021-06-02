# skynet_ts
* skynet typescript/javascript 脚本支持
* deno运行时环境支持

## 特性
* 很容易的集成到现有skynet服务中,与lua服务并存及交互
* TypeScript脚本,开发时丰富的类型系统
* 使用v8虚拟机,成熟高效的运行环境
* [Deno运行环境](https://deno.land/x),很方便的使用deno运行库,例如[grpc的测试](https://github.com/lsg2020/skynet_ts_demo/tree/demo/demo/service/grpc)
* [chrome devtools开发工具支持](https://github.com/lsg2020/skynet_ts/tree/master/doc/devtools.md)

## 测试
* [snjs deno.http服务](https://github.com/lsg2020/skynet_ts_demo/blob/demo/demo/service/benchmarks/http.ts)
    * skynet run main_http
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

* [snjs lua消息测试](https://github.com/lsg2020/skynet_ts_demo/blob/demo/demo/service/benchmarks/lua_msg.ts)
    * skynet run main_luamsg
    * snlua服务: `lua msg per sec:        370635`
    * snjs服务: `js msg per sec: 384704`

## 编译 [参见](https://github.com/lsg2020/skynet_ts_demo/blob/demo/README.md)
