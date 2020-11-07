let args = JS_INIT_ARGS.split(" ");
var SERVICE_NAME = args[0];
let skynet = Deno.skynet;

let js_lib_paths = skynet.get_env("jslib", "?;js/lib/?.js;js/lib/?/index.js");
let js_service_paths = skynet.get_env("jsservice", "js/service/?.js;js/service/?/main.js");
js_service_paths = js_service_paths.split(";");
let search_paths = [];
let main_service_path;
let main_pattern;
for (let service_path of js_service_paths) {
    let target_path = service_path.replace("?", SERVICE_NAME);
    if (Deno.exists_file(target_path)) {
        main_service_path = target_path;
        main_pattern = service_path;
        break;
    }
    search_paths.push(target_path);
}

if (!main_service_path) {
    throw new Error(`not found: ${search_paths.join("\n")}`);
}

let base_service_path = main_pattern.match(/(.*\/)/)[0];
var SERVICE_PATH = base_service_path.replace("?", SERVICE_NAME);
Deno.core.set_jslib_paths(`${SERVICE_PATH}/?.js;${SERVICE_PATH}/?/index.js;` + js_lib_paths);
try {
    await import(main_service_path);
} catch (e) {
    skynet.error(`snjs service:${JS_INIT_ARGS} file:${main_service_path} error: ${e.stack}`);
    skynet.exit();
}

export {}