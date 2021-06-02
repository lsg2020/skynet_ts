## 使用 `chrome devtools` 调试 skynet.snjs 服务
* `config`配置增加 `js_inspector = true`
* 启动入口页服务: `skynet.call(".launcher", "lua" , "LAUNCH", "snjs", "v8_inspector", "0.0.0.0", 9527)` 通过页面`http://127.0.0.1:9527`查看已开启调试的服务信息. 
* 服务开启调试支持:`snjs`服务执行 
```
import * as debug from "skynet/debug"; 
debug.v8inspector.enable(service_name);
```
* service_name: 展示服务名
* 进入入口页`http://127.0.0.1:9527`获取服务连接信息 
![image1](https://github.com/lsg2020/skynet_ts/blob/master/doc/images/image1.jpg)
* 在chrome 浏览器进入调试地址 例如: `devtools://devtools/bundled/inspector.html?v8only=true&ws=192.168.163.128:9527/ws/12`
* 配置chrome, `Customize and control DevTools` -> `More Tools` -> `JavaScript Profiler`

## 展示
![breakpoint](https://github.com/lsg2020/skynet_ts/blob/master/doc/images/breakpoint1.jpg)
![memory](https://github.com/lsg2020/skynet_ts/blob/master/doc/images/memory.jpg)
![cpuprofile](https://github.com/lsg2020/skynet_ts/blob/master/doc/images/cpuprofile1.jpg)

