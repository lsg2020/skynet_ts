import * as skynet from "skynet"
import * as handle_gm from "cmds/handle_gm"

let handles = new Map<string, Function>();
handle_gm.register(handles);

function dispatch_lua(context: skynet.CONTEXT, cmd: string, ...params: any) {
    let handle = handles.get(cmd);
    //console.trace()
    skynet.assert(handle, `not exists cmd:${cmd}`);
    handle!(context, ...params);
}

skynet.start(() => {
    skynet.dispatch("lua", dispatch_lua);
    skynet.register(".test")
})