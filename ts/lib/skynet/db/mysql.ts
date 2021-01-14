import * as skynet from "skynet"
import * as socket_channel from "skynet/socket/channel"
import * as pack from "pack"
import * as crypt from "crypt"
import {utf8} from "utf8"

let CHARSET_MAP = new Map([
    ["_default", 0],
    ["big5", 1],
    ["dec8", 3],
    ["cp850", 4],
    ["hp8", 6],
    ["koi8r", 7],
    ["latin1", 8],
    ["latin2", 9],
    ["swe7", 10],
    ["ascii", 11],
    ["ujis", 12],
    ["sjis", 13],
    ["hebrew", 16],
    ["tis620", 18],
    ["euckr", 19],
    ["koi8u", 22],
    ["gb2312", 24],
    ["greek", 25],
    ["cp1250", 26],
    ["gbk", 28],
    ["latin5", 30],
    ["armscii8", 32],
    ["utf8", 33],
    ["ucs2", 35],
    ["cp866", 36],
    ["keybcs2", 37],
    ["macce", 38],
    ["macroman", 39],
    ["cp852", 40],
    ["latin7", 41],
    ["utf8mb4", 45],
    ["cp1251", 51],
    ["utf16", 54],
    ["utf16le", 56],
    ["cp1256", 57],
    ["cp1257", 59],
    ["utf32", 60],
    ["binary", 63],
    ["geostd8", 92],
    ["cp932", 95],
    ["eucjpms", 97],
    ["gb18030", 248],
]);

enum FieldType {
    OK = "OK",
    ERR = "ERR",
    EOF = "EOF",
    DATA = "DATA",
}

const COM_QUERY = new Uint8Array([0x03]);
const COM_PING = new Uint8Array([0x0e]);
const COM_STMT_PREPARE = new Uint8Array([0x16]);
const COM_STMT_EXECUTE = new Uint8Array([0x17]);
const COM_STMT_CLOSE = new Uint8Array([0x19]);
const COM_STMT_RESET = new Uint8Array([0x1a]);
const CURSOR_TYPE_NO_CURSOR = 0x00
const SERVER_MORE_RESULT_EXISTS = 8

let converters = new Map([
    [0x01, Number],
    [0x02, Number],
    [0x03, Number],
    [0x04, Number],
    [0x05, Number],
    [0x08, Number],
    [0x09, Number],
    [0x0d, Number],
    [0xf6, Number],
])

export type Options = {
    host: string,
    port?: number,
    max_packet_size?: number,
    database?: string,
    user?: string,
    password?: string,
    charset?: string,
    overload?: boolean,
    compact?: boolean,
    on_connect?: () => void,
};

class ResultError extends Error {
    msg?: string;
    errno?: number;
    sqlstate?: string;

    constructor(msg?: string, errno?: number, sqlstate?: string) {
        super(msg);
        this.msg = msg;
        this.errno = errno;
        this.sqlstate = sqlstate;
    }
};

type PacketResponse = {
    affected_rows?: number,
    insert_id?: number,
    server_status: number,
    warning_count: number,
    message?: string,
    again?: boolean,
};

type Col = {
    name: string,
    type: number,
    is_signed: boolean,
};
type RowValue = any;
type RowArray = Array<RowValue>;
type RowMap = Map<string, RowValue>
type Row = RowArray|RowMap;

export class Mysql {
    public static async connect(ops: Options) {
        let mysql = new Mysql(ops);
        return mysql;
    }

    max_packet_size = 0;
    packet_no = 0;
    protocol_ver = 0;
    server_ver = "";
    server_capabilities = 0;
    server_lang = 0;
    server_status = 0;
    private compact = false;
    private channel: socket_channel.Channel;
    private query_resp?: (sock: socket_channel.Channel) => Promise<[boolean, any]>;
    private prepare_resp?: (sock: socket_channel.Channel) => Promise<[boolean, any]>;
    private execute_resp?: (sock: socket_channel.Channel) => Promise<[boolean, any]>;

    constructor(ops: Options) {
        this.max_packet_size = ops.max_packet_size || 1024*1024; // default 1MB
        this.compact = ops.compact || false;

        this.channel = new socket_channel.Channel({
            host: ops.host,
            port: ops.port || 3306,
            overload: ops.overload,
            auth: this._mysql_login(ops.user || "", ops.password || "", CHARSET_MAP.get(ops.charset!) || 33, ops.database || "", ops.on_connect),
        });

        // try connect first only once
        this.channel.connect(true);
    }

    disconnect() {
        this.channel.close();
    }

    async query(query: Uint8Array): Promise<any>;
    async query(query: string): Promise<any>;
    async query(query: string|Uint8Array) {
        let query_buff: Uint8Array;
        if (typeof(query) == "string") {
            query_buff = new TextEncoder().encode(query);
        } else {
            query_buff = query;
        }
        let query_packet = this._compose_com_packet(COM_QUERY, query_buff);
        let channel = this.channel;
        if (!this.query_resp) {
            this.query_resp = this._query_resp();
        }
        return await channel.request(query_packet, this.query_resp);
    }

    async prepare(sql: Uint8Array): Promise<any>;
    async prepare(sql: string): Promise<any>;
    async prepare(sql: string|Uint8Array) {
        let query_buff: Uint8Array;
        if (typeof(sql) == "string") {
            query_buff = new TextEncoder().encode(sql);
        } else {
            query_buff = sql;
        }

        let query_packet = this._compose_com_packet(COM_STMT_PREPARE, query_buff);
        let channel = this.channel;
        if (!this.prepare_resp) {
            this.prepare_resp = this._prepare_resp();
        }
        return await channel.request(query_packet, this.prepare_resp);
    }

    async execute(stmt: any, ...params: any[]) {
        let query_packet: Uint8Array;
        try {
            query_packet = this._compose_stmt_execute(stmt, CURSOR_TYPE_NO_CURSOR, ...params);
        } catch(e) {
            return {
                badresult: true,
                errno: 30902,
                err: e.message,
            };
        }
        
        let channel = this.channel;
        if (!this.execute_resp) {
            this.execute_resp = this._execute_resp();
        }
        return channel.request(query_packet, this.execute_resp);
    }

    private static _from_length_coded_bin(data: Uint8Array, pos: number): [number, number?] {
        let first = pack.decode_uint8_le(data, pos);
        if (first === undefined) {
            return [pos, undefined];
        }
        
        if (first >= 0 && first <= 250) {
            return [pos+1, first];
        }
        if (first == 251) {
            return [pos+1, undefined];
        }
        if (first == 252) {
            return [pos+3, pack.decode_uint_le(data, pos+1, 2)];
        }
        if (first == 253) {
            return [pos+4, pack.decode_uint_le(data, pos+1, 3)];
        }
        if (first == 254) {
            return [pos+9, pack.decode_uint_le(data, pos+1, 8)];
        }
        return [pos+1, undefined];
    }

    private static _set_length_code_bin(data: pack.encoder, n: number) {
        if (n < 251) {
            data.uint8_le(n);
            return;
        }

        if (n < (1 << 16)) {
            data.uint8_le(0xfc);
            data.uint_le(n, 2);
            return;
        }
        if (n < (1 << 24)) {
            data.uint8_le(0xfd);
            data.uint_le(n, 3);
            return;
        }
        data.uint8_le(0xfe);
        data.uint_le(n, 8);
        return;
    }

    private static _from_length_coded_buffer(data: Uint8Array, pos: number): [number, Uint8Array?] {
        let len: number|undefined;
        [pos, len] = Mysql._from_length_coded_bin(data, pos);
        if (len === undefined) {
            return [pos, undefined];
        }
        return [pos + len, data.slice(pos, pos+len)]
    }

    private static _from_length_coded_str(data: Uint8Array, pos: number): [number, string?] {
        let [index, value] = Mysql._from_length_coded_buffer(data, pos);
        if (!value) {
            return [index, undefined];
        }
        return [index, pack.sub_str(value)];
    }

    private _compose_packet(...reqs: Uint8Array[]) {
        this.packet_no++;
        if (this.packet_no > 255) {
            this.packet_no = 0;
        }
        let size = 0;
        reqs.forEach((req) => size += req.length);
        let packet = new Uint8Array(3+1+size);
        let pos = 0;
        pack.encode_uint_le(packet, pos, size, 3); pos += 3;
        pack.encode_uint8_le(packet, pos, this.packet_no); pos += 1;
        reqs.forEach((req) => {
            packet.set(req, pos);
            pos += req.length;
        });
        return packet;
    }

    private async _recv_packet(sock: socket_channel.Channel): Promise<[Uint8Array, FieldType]> {
        let [ok, msg, sz] = await sock.read(4);
        if (!ok) {
            throw new Error("failed to receive packet header");
        }
        let len = pack.decode_uint_le(msg!, 0, 3);
        if (len == 0) {
            throw new Error("empty packet");
        }
    
        this.packet_no = pack.decode_uint8_le(msg!, 3);
        [ok, msg, sz] = await sock.read(len);
        if (!ok) {
            throw new Error("failed to read packet content");
        }
    
        let field_count = pack.decode_uint8_le(msg!, 0);
        let type: FieldType;
        if (field_count == 0x00) {
            type = FieldType.OK;
        } else if (field_count == 0xff) {
            type = FieldType.ERR;
        } else if (field_count == 0xfe) {
            type = FieldType.EOF;
        } else {
            type = FieldType.DATA;
        }
    
        return [msg!.subarray(0, sz), type];
    }

    private _compute_token(password: string, scramble1: Uint8Array, scramble2: Uint8Array) {
        if (password == "") {
            return new Uint8Array(0);
        }
    
        let stage1 = crypt.sha1.array(password);
        let stage2 = crypt.sha1.array(stage1);

        let temp = new Uint8Array(scramble1.length + scramble2.length + stage2.length);
        temp.set(scramble1, 0);
        temp.set(scramble2, scramble1.length);
        temp.set(stage2, scramble1.length + scramble2.length);
        let stage3 = crypt.sha1.array(temp);
    
        let r = stage3;
        for (let i=0; i<r.length; i++) {
            r[i] = r[i] ^ stage1[i];
        }
        return r;
    }
    
    private _parse_ok_packet(packet: Uint8Array) {
        let res: PacketResponse = {server_status: 0, warning_count: 0};
        let pos = 1;
        [pos, res.affected_rows] = Mysql._from_length_coded_bin(packet, pos);
        [pos, res.insert_id] = Mysql._from_length_coded_bin(packet, pos);
        res.server_status = pack.decode_uint16_le(packet, pos); pos += 2;
        res.warning_count = pack.decode_uint16_le(packet, pos); pos += 2;
        let message = pack.sub_str(packet, pos);
        if (message && message != "") {
            res.message = message;
        }
        return res;
    }

    private _parse_eof_packet(packet: Uint8Array): [number, number] {
        let pos = 1;
        let warning_count: number;
        let status_flags: number;
        warning_count = pack.decode_uint16_le(packet, pos); pos += 2;
        status_flags = pack.decode_uint16_le(packet, pos); pos += 2;
        return [warning_count, status_flags];
    }

    private _parse_err_packet(packet: Uint8Array): [number, string, string?] {
        let pos = 1;
        let errno = pack.decode_uint16_le(packet, pos); pos += 2;
        let marker = pack.sub_str(packet, pos, pos+1);
        let sqlstate: string|undefined;
        if (marker == '#') {
            // with sqlstate
            pos += 1;
            sqlstate = pack.sub_str(packet, pos, pos + 5); pos += 5;
        }
        let message = pack.sub_str(packet, pos);
        return [errno, message, sqlstate];
    }

    private _parse_result_set_header_packet(packet: Uint8Array): [number, number, number] {
        let field_count: number|undefined;
        let extra: number|undefined;
        let pos = 0;
        [pos, field_count] = Mysql._from_length_coded_bin(packet, pos);
        [pos, extra] = Mysql._from_length_coded_bin(packet, pos);
        return [field_count || 0, extra || 0, pos]
    }

    private _parse_field_packet(data: Uint8Array): Col {
        let catalog: string|undefined;
        let db: string|undefined;
        let table: string|undefined;
        let orig_table: string|undefined;
        let orig_name: string|undefined;
        let charsetnr: number;
        let length: number;
        let flags: number;

        let col_name: string|undefined;
        let col_type: number;
        let col_is_signed = false;
        
        let pos = 0;
        [pos, catalog] = Mysql._from_length_coded_str(data, pos);
        [pos, db] = Mysql._from_length_coded_str(data, pos);
        [pos, table] = Mysql._from_length_coded_str(data, pos);
        [pos, orig_table] = Mysql._from_length_coded_str(data, pos);
        [pos, col_name] = Mysql._from_length_coded_str(data, pos);
        [pos, orig_name] = Mysql._from_length_coded_str(data, pos);

        pos += 1;
        charsetnr = pack.decode_uint16_le(data, pos); pos+= 2;
        length = pack.decode_uint32_le(data, pos); pos+= 4;
        col_type = pack.decode_uint8_le(data, pos); pos+= 1;
        pos += 1;
        flags = pack.decode_uint16_le(data, pos); pos+= 2;
        if ((flags & 0x20) == 0) {
            col_is_signed = true;
        }
        return {
            name: col_name!,
            type: col_type,
            is_signed: col_is_signed,
        }
    }

    private _parse_row_data_packet(data: Uint8Array, cols: Array<Col>, compact?: boolean) {
        let pos = 0;
        let row: Row = compact ? new Array<RowValue>() : new Map<string, RowValue>();

        cols.forEach((col) => {
            let value: any;
            [pos, value] = Mysql._from_length_coded_buffer(data, pos);
            if (value !== undefined) {
                let conv = converters.get(col.type);
                if (conv) {
                    value = conv(String.fromCharCode.apply(null, Array.from(value)));
                }
            }

            if (compact) {
                (row as RowArray).push(value);
            } else {
                (row as RowMap).set(col.name, value);
            }
        });
        return row;
    }

    private async _recv_field_packet(sock: socket_channel.Channel) {
        let [packet, type] = await this._recv_packet(sock);
        if (type == FieldType.ERR) {
            let [errno, msg, sqlstate] = this._parse_err_packet(packet);
            throw new ResultError(msg, errno, sqlstate);
        }
        if (type != FieldType.DATA) {
            throw new ResultError(`bad field packet type: ${type}`);
        }

        return this._parse_field_packet(packet);
    }
        
    private _recv_decode_packet_resp() {
        return async (sock: socket_channel.Channel): Promise<[boolean, Uint8Array|string]> => {
            let packet, type;
            try {
                [packet, type] = await this._recv_packet(sock);
            } catch (e) {
                return [false, `failed to receive the result pack ${e.message}`];
            }
    
            if (type == FieldType.ERR) {
                let [errno, msg, sqlstate] = this._parse_err_packet(packet);
                return [false, `errno:${errno} msg:${msg} sqlstate:${sqlstate}`];
            }
    
            if (type == FieldType.EOF) {
                return [false, `old pre-4.1 authentication protocol not supported`];
            }
    
            return [true, packet];
        }
    }
    
    private _mysql_login(user: string, password: string, charset: number, database: string, on_connect?: (mysql: Mysql) => void) {
        return async (sockchannel: socket_channel.Channel) => {
            let dispatch_resp = this._recv_decode_packet_resp();
            let packet = await sockchannel.response(dispatch_resp);
            let pos = 0;
            this.protocol_ver = pack.decode_uint8_le(packet, pos); pos += 1;
            let server_ver = pack.sub_str(packet, pos, packet.indexOf(0, pos));
            if (!server_ver) {
                throw new Error(`bad handshake initialization packet: bad server version`);
            }
    
            this.server_ver = server_ver;
            pos += server_ver.length + 1;
            let thread_id = pack.decode_uint32_le(packet, pos); pos += 4;
            //let scramble1 = pack.sub_str(packet, pos, pos + 8);
            let scramble1 = packet.slice(pos, pos+8);
            if (scramble1.length != 8) {
                throw new Error(`1st part of scramble not found`);
            }
            pos += 9;
            
            this.server_capabilities = pack.decode_uint16_le(packet, pos); pos += 2;
            this.server_lang = pack.decode_uint8_le(packet, pos); pos += 1;
            this.server_status = pack.decode_uint16_le(packet, pos); pos += 2;
    
            let more_capabilities = pack.decode_uint16_le(packet, pos); pos += 2;
            this.server_capabilities = this.server_capabilities | more_capabilities << 16;
    
            let len = 21 - 8 - 1;
            pos = pos + 1 + 10;
            
            //let scramble_part2 = pack.sub_str(packet, pos, pos+len);
            let scramble_part2 = packet.slice(pos, pos+len);
            if (scramble_part2.length != len) {
                throw new Error(`2nd part of scramble not found`);
            }
    
            //let scramble = scramble1 + scramble_part2;
            let token = this._compute_token(password, scramble1, scramble_part2);
            let client_flags = 260047;
            let req = new pack.encoder();
            req.uint32_le(client_flags);
            req.uint32_le(this.max_packet_size);
            req.uint8_le(charset);
            req.padding(23);
            req.cstring(user);
            req.buffer(token, 1);
            req.cstring(database);

            let auth_packet = this._compose_packet(req.finish());
            await sockchannel.request(auth_packet, dispatch_resp);
            if (on_connect) {
                on_connect(this);
            }
        }
    }

    private _compose_com_packet(type: Uint8Array, ...reqs: Uint8Array[]) {
        this.packet_no = -1;
        return this._compose_packet(type, ...reqs);
    }

    private async _read_result(sock: socket_channel.Channel): Promise<[PacketResponse|Array<Row>, boolean]> {
        let [packet, type] = await this._recv_packet(sock);
        if (type == FieldType.ERR) {
            let [errno, msg, sqlstate] = this._parse_err_packet(packet);
            throw new ResultError(msg, errno, sqlstate);
        }

        if (type == FieldType.OK) {
            let res = this._parse_ok_packet(packet);
            return [res, ((res.server_status & SERVER_MORE_RESULT_EXISTS) != 0)];
        }

        if (type != FieldType.DATA) {
            throw new ResultError(`packet type ${type} not supported`);
        }

        let [field_count, extra] = this._parse_result_set_header_packet(packet);
        let cols = new Array<Col>();
        for (let i=0; i<field_count; i++) {
            cols[i] = await this._recv_field_packet(sock);
        }

        let [packet_eof, type_eof] = await this._recv_packet(sock);
        if (type_eof != FieldType.EOF) {
            throw new ResultError(`unexpected packet type ${type} while eof packet is expected`);
        }
        
        let compact = this.compact;
        let rows = new Array<Row>();
        while (true) {
            let [packet, type] = await this._recv_packet(sock);
            if (type == FieldType.EOF) {
                let [warning_count, status_flags] = this._parse_eof_packet(packet);
                if ((status_flags & SERVER_MORE_RESULT_EXISTS) != 0) {
                    return [rows, true];
                }
                break;
            }

            rows.push(this._parse_row_data_packet(packet, cols, compact));
        }
        return [rows, false];
    }

    private _query_resp() {
        return async (sock: socket_channel.Channel): Promise<[boolean, any]> => {
            let res: PacketResponse;
            let again: boolean;
            try {
                [res, again] = (await this._read_result(sock)) as [PacketResponse, boolean];
                if (!again) {
                    return [true, res];
                }
            } catch (e) {
                if (e instanceof ResultError) {
                    return [true, {
                        badresult: true,
                        err: e.message,
                        errno: e.errno,
                        sqlstate: e.sqlstate,
                    }];
                }
                return [false, e.message];
            }
    
            let multi_resultset: any = [res];
            do {
                try {
                    let rows: Row[];
                    [rows, again] = (await this._read_result(sock)) as [Row[], boolean];
                    multi_resultset.push(rows);
                } catch (e) {
                    if (e instanceof ResultError) {
                        return [true, {
                            badresult: true,
                            err: e.message,
                            errno: e.errno,
                            sqlstate: e.sqlstate,
                        }];
                    }
                    return [false, e.message];
                }
            } while(again);
    
            return [true, multi_resultset];
        }
    }

    private async _read_prepare_result(sock: socket_channel.Channel): Promise<[boolean, any]> {
        let packet: Uint8Array;
        let type: FieldType;
        try {
            [packet, type] = await this._recv_packet(sock);
        } catch(e) {
            return [false, {
                badresult: true,
                errno: 300101,
                err: e.message,                
            }];
        }

        if (type == FieldType.ERR) {
            let [errno, msg, sqlstate] = this._parse_err_packet(packet);
            return [true, {
                badresult: true,
                errno: errno,
                err: msg,
                sqlstate: sqlstate,
            }];
        }

        if (type != FieldType.OK) {
            return [false, {
                badresult: true,
                errno: 300201,
                err: `first typ must be OK,now ${type}`,
            }];
        }

        let pos = 1;
        let resp: any = {};
        resp.prepare_id = pack.decode_uint32_le(packet, pos); pos += 4;
        resp.field_count = pack.decode_uint16_le(packet, pos); pos += 2;
        resp.param_count = pack.decode_uint16_le(packet, pos); pos += 2;
        pos += 1;
        resp.warning_count = pack.decode_uint16_le(packet, pos); pos += 2;

        resp.params = new Array<Col>();
        resp.fields = new Array<Col>();
        if (resp.param_count > 0) {
            while (true) {
                try {
                    let col = await this._recv_field_packet(sock);
                    resp.params.push(col);
                } catch(e) {
                    break;
                }
            }
        }
        if (resp.field_count > 0) {
            while (true) {
                try {
                    let col = await this._recv_field_packet(sock);
                    resp.fields.push(col);
                } catch(e) {
                    break;
                }
            }
        }

        return [true, resp];
    }

    private _prepare_resp() {
        return async (sock: socket_channel.Channel) => {
            return this._read_prepare_result(sock);
        }
    }

    private static _store_types = new Map([
        ["number", [(data: pack.encoder, v: any) => {
            if (Number.isSafeInteger(v)) {
                data.uint16_le(0x08);
            } else {
                data.uint16_le(0x05);
            }
        }, (data: pack.encoder, v: any) => {
            if (Number.isSafeInteger(v)) {
                data.uint64_le(v as number);
            } else {
                data.double_le(v as number);
            }
        }]],
        ["string", [(data: pack.encoder, v: any) => {
            data.uint16_le(0x0f);
        }, (data: pack.encoder, v: any) => {
            let s = v as string;
            Mysql._set_length_code_bin(data, utf8.length(s));
            data.utf8_str(s, 0);
        }]],
        ["boolean", [(data: pack.encoder, v: any) => {
            data.uint16_le(0x01);
        }, (data: pack.encoder, v: any) => {
            if (v) {
                data.uint8_le(1);
            } else {
                data.uint8_le(0);
            }
        }]],
        ["undefined", [(data: pack.encoder, v: any) => {
            data.uint16_le(0x06);
        }, (data: pack.encoder, v: any) => {
        }]],
        ["object", [(data: pack.encoder, v: any) => {
            if (v instanceof Uint8Array) {
                data.uint16_le(0x0f);
            } else {
                skynet.assert(false);
            }
        }, (data: pack.encoder, v: any) => {
            if (v instanceof Uint8Array) {
                data.buffer(v, 0);
            } else {
                skynet.assert(false);
            }
        }]],        
    ]);
    private _compose_stmt_execute(stmt: any, cursor_type: number, ...args: any[]) {
        let arg_num = args.length;
        if (arg_num != stmt.param_count) {
            throw new Error(`require stmt.param_count ${stmt.param_count} get arg_num: ${arg_num}`);
        }

        this.packet_no = -1;
        let cmd_packet = new pack.encoder();
        cmd_packet.buffer(COM_STMT_EXECUTE, 0);
        cmd_packet.uint32_le(stmt.prepare_id);
        cmd_packet.uint8_le(cursor_type);
        cmd_packet.uint32_le(0x01);
        if (arg_num > 0) {
            let null_count = Math.floor((arg_num + 7) / 8);
            let field_index = 0;
            for (let i=0; i<null_count; i++) {
                let byte = 0;
                for (let j=0; j<8; j++) {
                    if (field_index < arg_num) {
                        if (args[field_index] === undefined) {
                            byte |= (1 << j);
                        }
                    }
                    field_index++;
                }
                cmd_packet.uint8_le(byte);
            }

            cmd_packet.uint8_le(0x01);
            for (let i=0; i<arg_num; i++) {
                let v = args[i];
                let f = Mysql._store_types.get(typeof(v));
                if (!f) {
                    throw new Error(`invalid parameter type ${typeof(v)}`);
                }
                f[0](cmd_packet, v);
            }
            for (let i=0; i<arg_num; i++) {
                let v = args[i];
                let f = Mysql._store_types.get(typeof(v));
                if (f) {
                    f[1](cmd_packet, v);
                }
            }
        }

        return this._compose_packet(cmd_packet.finish());
    }

    private static _get_datetime(data: Uint8Array, pos: number): [number, string] {
        let len: number|undefined;
        let value: string;
        [pos, len] = Mysql._from_length_coded_bin(data, pos);
        if (len == 7) {
            let year = pack.decode_uint16_le(data, pos); pos += 2;
            let month = pack.decode_uint8_le(data, pos); pos += 1;
            let day = pack.decode_uint8_le(data, pos); pos += 1;
            let hour = pack.decode_uint8_le(data, pos); pos += 1;
            let minute = pack.decode_uint8_le(data, pos); pos += 1;
            let second = pack.decode_uint8_le(data, pos); pos += 1;
            value = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
        } else {
            value = "2021-01-14 21:41:00";
            // unsupported format
            pos += len!;
        }        
        return [pos, value];
    }    
    private static _binary_parse = new Map([
        [0x01, (data: Uint8Array, pos: number): [number, any?] => {
            return [pos+1, pack.decode_uint8_le(data, pos)];
        }],
        [0x02, (data: Uint8Array, pos: number): [number, any?] => {
            return [pos+2, pack.decode_uint16_le(data, pos)];
        }],
        [0x03, (data: Uint8Array, pos: number): [number, any?] => {
            return [pos+4, pack.decode_uint32_le(data, pos)];
        }],
        [0x04, (data: Uint8Array, pos: number): [number, any?] => {
            let view = new DataView(data.buffer);
            return [pos+4, view.getFloat32(pos, true)];
        }],
        [0x05, (data: Uint8Array, pos: number): [number, any?] => {
            let view = new DataView(data.buffer);
            return [pos+8, view.getFloat64(pos, true)];
        }],
        [0x07, Mysql._get_datetime],
        [0x08, (data: Uint8Array, pos: number): [number, any?] => {
            return [pos+8, pack.decode_uint_le(data, pos, 8)];
        }],
        [0x09, (data: Uint8Array, pos: number): [number, any?] => {
            return [pos+3, pack.decode_uint_le(data, pos, 3)];
        }],
        [0x0c, Mysql._get_datetime],
        [0x0f, Mysql._from_length_coded_buffer],
        [0x10, Mysql._from_length_coded_buffer],
        [0xf9, Mysql._from_length_coded_buffer],
        [0xfa, Mysql._from_length_coded_buffer],
        [0xfb, Mysql._from_length_coded_buffer],
        [0xfc, Mysql._from_length_coded_buffer],
        [0xfd, Mysql._from_length_coded_buffer],
        [0xfe, Mysql._from_length_coded_buffer],
    ]);
    private _parse_row_data_binary(data: Uint8Array, cols: Array<Col>, compact: boolean) {
        let ncols = cols.length;
        let null_count = Math.floor((ncols + 9) / 8);
        let pos = 1 + null_count;

        let null_fields: boolean[] = [];
        let field_index = 0;
        for (let i=1; i<pos; i++) {
            let byte = pack.decode_uint8_le(data, i);
            for (let j=0; j<8; j++) {
                if (field_index > 2) {
                    null_fields[field_index-2] = ((byte & (1 << j)) != 0);
                }
                field_index++;
            }
        }
        
        let row: Row = compact ? new Array<RowValue>() : new Map<string, RowValue>();
        let value;
        for (let i=0; i<ncols; i++) {
            let col = cols[i];
            if (!null_fields[i]) {
                let parse = Mysql._binary_parse.get(col.type);
                if (!parse) {
                    throw new Error(`_parse_row_data_binary() error, unsupported field type ${col.type}`);
                }
                [pos, value] = parse(data, pos/*, col.is_signed*/);
                if (compact) {
                    (row as Array<RowValue>)[i] = value;
                } else {
                    (row as Map<string, RowValue>).set(col.name, value);
                }
            }
        }
        return row;
    }

    private async _read_execute_result(sock: socket_channel.Channel): Promise<[PacketResponse|Array<Row>, boolean]> {
        let [packet, type] = await this._recv_packet(sock);
        if (type == FieldType.ERR) {
            let [errno, msg, sqlstate] = this._parse_err_packet(packet);
            throw new ResultError(msg, errno, sqlstate);
        }

        if (type == FieldType.OK) {
            let res = this._parse_ok_packet(packet);
            return [res, ((res.server_status & SERVER_MORE_RESULT_EXISTS) != 0)];
        }

        if (type != FieldType.DATA) {
            throw new ResultError(`packet type ${type} not supported`);
        }

        let [field_count, extra] = this._parse_result_set_header_packet(packet);
        let cols = new Array<Col>();
        while (true) {
            let [packet, type] = await this._recv_packet(sock);
            if (type == FieldType.EOF) {
                this._parse_eof_packet(packet);
                break;
            }
            cols.push(this._parse_field_packet(packet));
        }
        if (cols.length < 1) {
            return [[], false];
        }

        let compact = this.compact;
        let rows = new Array<Row>();
        while (true) {
            let [packet, type] = await this._recv_packet(sock);
            if (type == FieldType.EOF) {
                let [warning_count, status_flags] = this._parse_eof_packet(packet);
                if ((status_flags & SERVER_MORE_RESULT_EXISTS) != 0) {
                    return [rows, true];
                }
                break;
            }

            rows.push(this._parse_row_data_binary(packet, cols, compact));
        }
        return [rows, false];
    }

    private _execute_resp() {
        return async (sock: socket_channel.Channel): Promise<[boolean, any]> => {
            let res: PacketResponse;
            let again: boolean;
            try {
                [res, again] = (await this._read_execute_result(sock)) as [PacketResponse, boolean];
                if (!again) {
                    return [true, res];
                }
            } catch (e) {
                if (e instanceof ResultError) {
                    return [true, {
                        badresult: true,
                        err: e.message,
                        errno: e.errno,
                        sqlstate: e.sqlstate,
                    }];
                }
                return [false, e.message];
            }
    
            let multi_resultset: any = [res];
            do {
                try {
                    let rows: Row[];
                    [rows, again] = (await this._read_execute_result(sock)) as [Row[], boolean];
                    multi_resultset.push(rows);
                } catch (e) {
                    if (e instanceof ResultError) {
                        return [true, {
                            badresult: true,
                            err: e.message,
                            errno: e.errno,
                            sqlstate: e.sqlstate,
                        }];
                    }
                    return [false, e.message];
                }
            } while(again);
    
            return [true, multi_resultset];
        }
    }

}

