# skynet_ts
skynet typescript/javascript 脚本支持
# build
1. 下载v8代码需配置代理
    `export https_proxy=192.168.163.1:10809
    export http_proxy=192.168.163.1:10809`
2. 下载v8 `git submodule update --init --recursive`
3. `export V8_FROM_SOURCE=/data/skynet_ts/rusty_v8/v8/`
4. `cargo build --release`
