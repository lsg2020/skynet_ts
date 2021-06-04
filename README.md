# skynet_ts
* skynet typescript/javascript 脚本支持
* deno运行时环境支持

## 特性
* 很容易的集成到现有skynet服务中,与lua服务并存及交互
* TypeScript脚本,开发时丰富的类型系统
* 使用v8虚拟机,成熟高效的运行环境
* [Deno运行环境](https://deno.land/x),很方便的使用deno运行库,例如[grpc的测试](https://github.com/lsg2020/skynet_ts_demo/tree/demo/demo/service/grpc)
* [chrome devtools开发工具支持](https://github.com/lsg2020/skynet_ts/tree/master/doc/devtools.md)

## [一些测试结果](https://github.com/lsg2020/skynet_ts/tree/master/doc/benchmark.md)

## 快速开始
* [编译](https://github.com/lsg2020/skynet_ts_demo/blob/demo/README.md)或使用[编译好的文件](https://github.com/lsg2020/skynet_ts_demo/releases)
* skynet
    * v8虚拟机切换线程会恢复数据，消息频繁时这里可以优化提升性能[参见](https://github.com/lsg2020/skynet/commit/220654849aee414b274ff9ab6ad0a05daed1c84d)
    * skynet_ts在deno异步事件返回时会通知skynet消息,使用消息类型`234`,与项目中类型冲突时也可[修改](https://github.com/lsg2020/skynet_ts/blob/4789e7eaaaee8dd47e25bcf37032d2e8ae6e2c1e/src/interface.rs#L96)
* skynet config配置
    * `js_loader`: js服务入口文件,例如:`./js/skynet_ts/ts/lib/loader.js`,[loader](https://github.com/lsg2020/skynet_ts/blob/master/ts/lib/loader.ts)生成的js对应路径
    * `jslib`: js库搜索路径,例如:`js/demo/lib/?.js;js/demo/lib/?/index.js;js/skynet_ts/ts/lib/?.js;js/skynet_ts/ts/lib/?/index.js;js/skynet_ts/ts/lib/skynet/?.js;js/skynet_ts/ts/lib/skynet/?/index.js`
    * `jsservice`: js服务搜索路径,例如:`js/demo/service/?.js;js/demo/service/?/main.js;js/skynet_ts/ts/service/?.js;js/skynet_ts/ts/service/?/main.js`
* 启动js服务 `skynet.call(".launcher", "lua" , "LAUNCH", "snjs", "test")`
* 使用skynet消息接口
``` ts
import * as skynet from "skynet"
skynet.start(async () => {
    skynet.dispatch("lua", async (context: skynet.CONTEXT, cmd: string, ...params: any) => {
        console.log(cmd);
    });
    skynet.register(".test")
})
```
* 使用deno接口
``` ts
import * as skynet from "skynet"
import * as uuid from "std/uuid/mod"
skynet.start(async () => {
    let data = await fetch("https://www.baidu.com");
    console.log(data);
    console.log(WebSocket);
    console.log(uuid.v4.generate());
})
```

