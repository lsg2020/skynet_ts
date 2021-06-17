import * as skynet from "skynet";
import * as log from "std/log/mod";
import type { LogRecord } from "std/log/logger";

let logger = ".logger_ts";
class SkynetHandler extends log.handlers.BaseHandler {
    format(msg: LogRecord) {
        skynet.send(logger, "lua", msg.level, msg.args[0], msg.msg, msg.level >= log.LogLevels.ERROR ? new Error().stack : undefined);
        return "";
    }
    log(msg: string): void {
    }
}

await log.setup({
    handlers: {
        skynet: new SkynetHandler("DEBUG"),
    },
    loggers: {
        skynet: {
            level: "DEBUG",
            handlers: ["skynet"],
        },
    },
});

export class Log {
    public static logger = log.getLogger("skynet");
};

export class Tags {
    _prefix?: string;
    _tags: {[key: string]: any};

    constructor(tags: {[key: string]: any}, prefix?: string) {
        this._prefix = prefix;
        if (prefix) {
            this._tags = {};
            for (let k in tags) {
                this._tags[`${this._prefix}_${k}`] = tags[k];
            }
        } else {
            this._tags = tags;
        }
    }
};

export class TaggedLogger {
    _tags: {[key: string]: any};
    public static new(...tags: Tags[]) {
        return new TaggedLogger(...tags);
    }

    constructor(...tags: Tags[]) {
        this._tags = {};
        for (let tag of tags) {
            Object.assign(this._tags, tag._tags);
        }
    }
    add(key: string, val: any) {
        this._tags[key] = val;
        return this;
    }

    
    debug(msg: string) {
        Log.logger.debug(msg, this._tags);
    }
    info(msg: string) {
        Log.logger.info(msg, this._tags);
    }
    warning(msg: string) {
        Log.logger.warning(msg, this._tags);
    }
    error(msg: string) {
        Log.logger.error(msg, this._tags);
    }
    critical(msg: string) {
        Log.logger.critical(msg, this._tags);
    }
}