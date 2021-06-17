import * as skynet from "skynet";
import * as log from "std/log/mod";
import type { LogRecord } from "std/log/logger";

let log_format = (record: LogRecord): string => {
    let [service_addr, stack, tags] = record.args as [number, string?, {[key: string]: string}?];
    let tags_str = "";
    if (tags) {
        for (let k in tags) {
            tags_str += `${k} = ${tags[k]} `;
        }
    }
    return `${record.datetime.toLocaleString()} [${skynet.address(service_addr as number)}] ${record.levelName} ${tags_str} ${record.msg} ${stack ? stack : ""}`;
}

let log_path = skynet.get_env("logpath", ".");
let file_handler = new log.handlers.RotatingFileHandler("DEBUG", {
    maxBytes: 1024*1024*3,
    maxBackupCount: 5,
    filename: `${log_path}/skynet.log`,
    formatter: log_format,
});
await log.setup({
    handlers: {
        skynet_console: new log.handlers.ConsoleHandler("DEBUG", {formatter: log_format}),
        skynet_file: file_handler,
    },
    loggers: {
        log_service: {
            level: "DEBUG",
            handlers: ["skynet_console", "skynet_file"],
        },
    },
});

let logger = log.getLogger("log_service");

let text_decoder = new TextDecoder();
skynet.register_protocol({
    id: skynet.PTYPE_ID.TEXT,
    name: skynet.PTYPE_NAME.TEXT,
    unpack: (buf: Uint8Array, offset: number, sz: number) => {
        return [text_decoder.decode(buf.subarray(offset, offset + sz))];
    },
    dispatch: (context: skynet.CONTEXT, msg: string) => {
        logger.info(msg, context.source);
    },
})

skynet.start(() => {
    (async () => {
        while (true) {
            file_handler.flush();
            await skynet.sleep(100 * 5);
        }
    })();

    skynet.dispatch("lua", (context: skynet.CONTEXT, level: number, tags: {[key: string]: string}, msg: string, stack?: string) => {
        if (level == log.LogLevels.DEBUG) {
            logger.debug(msg, context.source, stack, tags);
        } else if (level == log.LogLevels.INFO) {
            logger.info(msg, context.source, stack, tags);
        } else if (level == log.LogLevels.WARNING) {
            logger.warning(msg, context.source, stack, tags);
        } else if (level == log.LogLevels.ERROR) {
            logger.error(msg, context.source, stack, tags);
        } else if (level == log.LogLevels.CRITICAL) {
            logger.critical(msg, context.source, stack, tags);
        }
    });

    skynet.register(".logger_ts");
})