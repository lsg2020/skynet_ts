import * as skynet from "skynet"
import * as debug from "skynet/debug"
import * as handle_gm from "cmds/handle_gm"

let handles = new Map<string, Function>();
handle_gm.register(handles);

function dispatch_lua(context: skynet.CONTEXT, cmd: string, ...params: any) {
    let handle = handles.get(cmd);
    //console.trace()
    skynet.assert(handle, `not exists cmd:${cmd}`);
    handle!(context, ...params);
}

async function test() {
    let amount = 0;
    while (true) {
        let a = 1234;
        a = a + 1;
        let b = 4321;
        
        console.log(amount++, skynet.now());
        await skynet.sleep(700);
        if (amount == 1) {
            debug.v8inspector.disable();
        }
        let c = a + b;
        c = 0;
    }
}
skynet.start(async () => {
    let listen_debug = JS_INIT_ARGS.split(" ")[1];
    let service_name = JS_INIT_ARGS.split(" ")[0];
    if (listen_debug) {
        debug.v8inspector.enable(service_name, listen_debug);
    }

    skynet.dispatch("lua", dispatch_lua);
    skynet.register(".test")
    test()
})