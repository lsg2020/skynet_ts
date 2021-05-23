import * as skynet from "skynet"
import * as socket_channel from "skynet/socket/channel"
import * as crypt from "crypt"
import * as bson from "skynet/db/mongo/bson"
import * as pack from "pack"

export type TargetConf = {
    host: string,
    port?: number,
    username?: string,
    password?: string,
    authmod?: string,
    authdb?: string,
}

export type Options = {
    addr?: TargetConf,
    rs?: TargetConf[],
    overload?: boolean,
};

const OP_REPLY = 1;
const OP_MSG = 1000;
const OP_UPDATE = 2001;
const OP_INSERT = 2002;
const OP_QUERY = 2004;
const OP_GET_MORE = 2005;
const OP_DELETE = 2006;
const OP_KILL_CURSORS = 2007;
const REPLY_CURSORNOTFOUND = 1;
const REPLY_QUERYFAILURE = 2;
const REPLY_AWAITCAPABLE = 8;
const empty_bson = bson.encode({}).slice();
function op_query(request_id: number, flags: number, collection: string, skip: number, ret_number: number, documents: Uint8Array[]) {
    let buf = new pack.encoder();
    buf.reserve(4);
    buf.int32(request_id, true);
    buf.int32(0, true);
    buf.int32(OP_QUERY, true);
    buf.int32(flags, true);
    buf.cstring(collection);
    buf.int32(skip, true);
    buf.int32(ret_number, true);
    let len = buf._pos;
    documents.forEach((doc) => len += doc.length);;
    pack.encode_uint32(buf._buffer, 0, len, true);
    return buf.finish();
}

function op_insert(flags: number, collection: string, documents: Uint8Array[]) {
    let buf = new pack.encoder();
    buf.reserve(4);
    buf.int32(0, true);
    buf.int32(0, true);
    buf.int32(OP_INSERT, true);
    buf.int32(flags, true);
    buf.cstring(collection);
    let len = buf._pos;
    documents.forEach((doc) => len += doc.length);
    pack.encode_uint32(buf._buffer, 0, len, true);
    return buf.finish();
}

function op_get_more(request_id: number, collection: string, limit: number, cursor_id: bigint) {
    let buf = new pack.encoder();
    buf.reserve(4);
    buf.int32(request_id, true);
    buf.int32(0, true);
    buf.int32(OP_GET_MORE, true);
    buf.int32(0, true);
    buf.cstring(collection);
    buf.int32(limit, true);
    buf.bigint(cursor_id, 8, true);
    let len = buf._pos;
    pack.encode_uint32(buf._buffer, 0, len, true);
    return buf.finish();
}

function op_kill(cursor_id: bigint) {
    let buf = new pack.encoder();
    buf.reserve(4);
    buf.int32(0, true);
    buf.int32(0, true);
    buf.int32(OP_KILL_CURSORS, true);
    buf.int32(0, true);
    buf.int32(1, true);
    buf.bigint(cursor_id, 8, true);
    let len = buf._pos;
    pack.encode_uint32(buf._buffer, 0, len, true);
    return buf.finish();
}

type REPLY = {
    results: any[],
    cursor_id: bigint,
    starting: number,
}
function op_reply(msg: Uint8Array, sz: number): [boolean, number?, REPLY?] {
    let header_len = 4 * 8;
    if (sz < header_len) {
        return [false];
    }
    let pos = 0;
    let request_id = pack.decode_uint32(msg, pos, true); pos += 4;
    let response_id = pack.decode_uint32(msg, pos, true); pos += 4;
    let opcode = pack.decode_uint32(msg, pos, true); pos += 4;
    let flags = pack.decode_uint32(msg, pos, true); pos += 4;
    if (flags & REPLY_QUERYFAILURE) {
        return [false, response_id];
    }

    let cursor_id = pack.decode_bigint(msg, pos, 8, true); pos += 8;
    let starting = pack.decode_uint32(msg, pos, true); pos += 4;
    let n = pack.decode_uint32(msg, pos, true); pos += 4;

    let results: any[] = [];
    while (pos + 4 < sz) {
        let doc_len = pack.decode_int32(msg, pos, true);
        if (doc_len <= 0) {
            throw new Error(`invalid result bson document`);
        }
        
        results.push(bson.decode(msg, pos + doc_len, pos));
        pos += doc_len;
    }

    if (results.length != n) {
        return [false, response_id];
    }

    return [true, response_id, {
        results: results,
        cursor_id: cursor_id,
        starting: starting,
    }];
}

function op_update(collection: string, flags: number, datas: Uint8Array[]) {
    let buf = new pack.encoder();
    buf.reserve(4);
    buf.int32(0, true);
    buf.int32(0, true);
    buf.int32(OP_UPDATE, true);
    buf.int32(0, true);
    buf.cstring(collection);
    buf.int32(flags, true);

    let len = buf._pos;
    datas.forEach((data) => len += data.length);
    pack.encode_uint32(buf._buffer, 0, len, true);
    return buf.finish(); 
}

function op_delete(collection: string, single: number, datas: Uint8Array[]) {
    let buf = new pack.encoder();
    buf.reserve(4);
    buf.int32(0, true);
    buf.int32(0, true);
    buf.int32(OP_DELETE, true);
    buf.int32(0, true);
    buf.cstring(collection);
    buf.int32(single, true);

    let len = buf._pos;
    datas.forEach((data) => len += data.length);
    pack.encode_uint32(buf._buffer, 0, len, true);
    return buf.finish(); 
}

async function dispatch_reply(sock: socket_channel.Channel): Promise<[number, boolean, any]> {
    let [ok, msg, sz] = await sock.read(4);
    if (!ok) {
        throw new Error("failed to receive packet header");
    }
    let len = pack.decode_uint32(msg!, 0, true);
    if (len < 4) {
        throw new Error("failed to receive apcket header");
    }
    [ok, msg, sz] = await sock.read(len - 4);
    let [success, reply_id, reply] = op_reply(msg!, sz!);
    return [reply_id || 0, success, reply]
}

type sort_field = [string, (1|-1)?]; // [name, order]
type index_option = {
    fields: sort_field[];
    unique?: boolean;
    name?: string;
}

type FindAndModify = {query: Object, sort?: Object, remove?: boolean, update?: Object, new?: boolean, fields?: boolean, upsert?: boolean};
class MongoCollection {
    _name: string;
    _full_name: string;
    _client: MongoClient;
    _database: MongoDb;

    constructor(collection: string, db: MongoDb, client: MongoClient) {
        this._name = collection;
        this._full_name = `${db.full_name()}.${collection}`;
        this._database = db;
        this._client = client;
    }

    insert(doc: any) {
        let socket = this._client.sock();
        let doc_bson = bson.encode(doc);
        let pack = op_insert(0, this._full_name, [doc_bson]);
        socket.request([pack, doc_bson]);
    }

    async safe_insert(doc: any) {
        let r = await this._database.run_command("insert", this._name, "documents", [doc]);
        return this._werror(r);
    }

    batch_insert(docs: any[]) {
        let doc_bsons: Uint8Array[] = [];
        for (let doc of docs) {
            doc_bsons.push(bson.encode(doc));
        }

        let pack = op_insert(0, this._full_name, doc_bsons);
        let socket = this._client.sock();
        socket.request([pack, ...doc_bsons]);
    }

    update(selector: any, update: any, upsert: boolean, multi: boolean) {
        let flags = (upsert && 1 || 0) + (multi && 2 || 0);
        let socket = this._client.sock();
        let doc_bsons = [bson.encode(selector), bson.encode(update)];
        let pack = op_update(this._full_name, flags, doc_bsons);
        socket.request([pack, ...doc_bsons]);
    }

    async safe_update(selector: any, update: any, upsert: boolean, multi: boolean) {
        let r = await this._database.run_command("update", this._name, "updates", [{
            q: selector,
            u: update,
            upsert: upsert,
            multi: multi,
        }]);
        return this._werror(r);
    }

    delete(selector: any, single: boolean) {
        let socket = this._client.sock();
        let doc_bsons = [bson.encode(selector)];
        let pack = op_delete(this._full_name, single && 1 || 0, doc_bsons);
        socket.request([pack, ...doc_bsons]);
    }

    async safe_delete(selector: any, single: boolean) {
        let r = await this._database.run_command("delete", this._name, "deletes", [{
            q: selector,
            limit: single && 1 || 0,
        }]);
        return this._werror(r);
    }

    async find_one(query: Object = {}, selector: Object = {}) {
        let request_id = this._client.gen_id();
        let socket = this._client.sock();
        let doc_bsons = [bson.encode(query), bson.encode(selector)];
        let pack = op_query(request_id, 0, this._full_name, 0, 1, doc_bsons);
        let req = await socket.request([pack, ...doc_bsons], request_id);
        return (req as REPLY).results[0];
    }

    async find_and_modify(doc: FindAndModify) {
        skynet.assert(doc.query);
        skynet.assert(doc.update || doc.remove);

        let params: any[] = [];
        let k: (keyof FindAndModify);
        for (k in doc) {
            let v = doc[k];
            params.push(k);
            params.push(v);
        }
        let r = await this._database.run_command("findAndModify", this._name, ...params);
        return r;
    }

    find(query: Object = {}, selector: Object = {}) {
        return new MongoCursor(this, query, selector);
    }

    private _werror(r: any): [boolean, string] {
        let ok = (r.ok == 1 && !r.writeErrors && !r.writeConcernError && !r.errmsg);
        let err: string = "";
        if (!ok) {
            if (r.writeErrors) {
                err = r.writeErrors[0].errmsg;
            } else if (r.writeConcernError) {
                err = r.writeConcernError.errmsg;
            } else {
                err = r.errmsg;
            }
        }

        return [ok, err]
    }

    async drop() {
        let r = await this._database.run_command("drop", this._name);
        return r;
    }

    async drop_index(name: string) {
        let r = await this._database.run_command("dropIndexes", this._name, "index", name);
        return r;
    }

    private normalize_index(option: index_option): any {
        let keys: any = {};
        let name = "";
        option.fields.forEach((f) => {
            let k = f[0];
            let order = f[1] || 1;
            keys[k] = order;
            name += (name ? "_" : "") + String(k) + "_" + String(order);
        });

        skynet.assert(name, "need keys");
        let doc: any = {
            name: option.name || name,
            key: keys,
            unique: option.unique,
        };
        return doc;
    }
    async create_index(option: index_option): Promise<any> {
        let doc = this.normalize_index(option);
        let r = await this._database.run_command("createIndexes", this._name, "indexes", [doc]);
        return r;
    }

    async create_indexes(options: index_option[]): Promise<any> {
        let docs: any[] = [];
        options.forEach((option) => {
            docs.push(this.normalize_index(option));
        })
        let r = await this._database.run_command("createIndexes", this._name, "indexes", docs);
        return r;
    }
}

class MongoCursor {
    _collection: MongoCollection;
    _query: Object;
    _sort_query?: Object;
    _selector: Object;
    _limit = 0;
    _skip = 0;
    _ptr?: number;
    _eof = false;
    _data?: any[];
    _cursor?: bigint;
    constructor(collection: MongoCollection, query: Object, selector: Object) {
        this._collection = collection;
        this._query = query;
        this._selector = selector;
    }

    skip(amount: number) {
        this._skip = amount;
        return this;
    }
    limit(amount: number) {
        this._limit = amount;
        return this;
    }
    sort(keys: sort_field[]) {
        let orderby: any[] = [];
        keys.forEach((k) => {
            orderby.push(k[0]);
            orderby.push(k[1] || 1);
        })
        this._sort_query = {
            $query: this._query,
            $orderby: orderby,
        }
        return this;
    }
    async count(with_limit_and_skip?: boolean) {
        let params: any[] = ["query", this._query];
        if (with_limit_and_skip) {
            params.push(...["limit", this._limit, "skip", this._skip]);
        }
        let ret = await this._collection._database.run_command("count", this._collection._name, ...params);
        skynet.assert(ret && ret.ok == 1);
        return ret.n;
    }

    async close() {
        if (this._cursor) {
            let pack = op_kill(this._cursor);
            await this._collection._client.sock().request(pack);
            this._cursor = undefined;
        }
    }

    async has_next() {
        if (this._ptr !== undefined) {
            return true;
        }
        if (this._eof) {
            return false;
        }

        let conn = this._collection._client;
        let request_id = conn.gen_id();

        let pack: Uint8Array[] = [];
        if (!this._data) {
            let query = this._sort_query || this._query;
            let doc_bsons = [bson.encode(query), bson.encode(this._selector)];
            let header = op_query(request_id, 0, this._collection._full_name, this._skip, this._limit, doc_bsons);
            pack.push(...[header, ...doc_bsons]);
        } else {
            if (this._cursor) {
                let header = op_get_more(request_id, this._collection._full_name, this._limit, this._cursor);
                pack.push(header);
            } else {
                // no more
                this._eof = true;
                this._data = undefined;
                return false;
            }
        }

        let ret = await conn.sock().request(pack, request_id);
        if (!ret.results) {
            this._eof = true;
            this._data = undefined;
            this._cursor = undefined;
            return false;
        }
        this._data = ret.results;
        this._ptr = 0;
        this._cursor = ret.cursor_id;
        if (this._cursor && this._limit) {
            this._limit = this._limit - this._data!.length;
            if (this._limit <= 0) {
                this._limit = 0;
                await this.close();
            }
        }
        return true;
    }

    next() {
        if (this._ptr === undefined) {
            throw new Error(`call has_next first`);
        }

        let r = this._data![this._ptr++];
        if (this._ptr >= this._data!.length) {
            this._ptr = undefined;
        }
        return r;
    }
}

class MongoDb {
    private _name: string;
    private _full_name: string;
    private _cmd: string;
    private _client: MongoClient;
    constructor(client: MongoClient, name: string) {
        this._client = client;
        this._name = name;
        this._full_name = name;
        this._cmd = `${name}.$cmd`;
    }

    full_name() {
        return this._full_name;
    }

    async run_command(cmd: string, ...params: any[]) {
        let request_id = this._client.gen_id();
        let sock = this._client.sock();
        let bson_cmd: Uint8Array;
        if (params.length) {
            bson_cmd = bson.encode_order(cmd, ...params);
        } else {
            bson_cmd = bson.encode_order(cmd, 1);
        }
        let query = op_query(request_id, 0, this._cmd, 0, 1, [bson_cmd]);
        let req = await sock.request([query, bson_cmd], request_id);
        return (req as REPLY).results[0];
    }

    get_collection(name: string) {
        let collection = new MongoCollection(name, this, this._client);
        return collection;
    }
};

export class MongoClient {
    static async client(ops: Options) {
        let client = new MongoClient(ops);
        // try connect only once
        await client.connect(true)
        return client;
    }
    
    private _id = 0;
    private _target: TargetConf;
    private _sock: socket_channel.Channel|undefined;
    private _dbs = new Map<string, MongoDb>();
    constructor(ops: Options) {
        this._target = ops.addr || ops.rs![0];
        
        let backup: socket_channel.ADDRESS_EX[]|undefined;
        if (ops.rs) {
            backup = [];
            ops.rs.forEach((target) => backup!.push({host: target.host, port: target.port || 27017}));
        }

        this._sock = new socket_channel.Channel({
            host: this._target.host,
            port: this._target.port || 27017,
            nodelay: true,
            overload: ops.overload,
            backup: backup,
            response: dispatch_reply,
            auth: this._mongo_auth(),
        })
    }

    async connect(once?: boolean) {
        await this._sock!.connect(once);
    }

    disconnect() {
        if (this._sock) {
            let so = this._sock;
            this._sock = undefined;
            so.close();
        }
    }

    async logout() {
        let result = await this.get_db().run_command("logout");
        return result.ok == 1;
    }

    get_db(name: string = "admin") {
        let db = this._dbs.get(name);
        if (!db) {
            db = new MongoDb(this, name);
            this._dbs.set(name, db);
        }
        return db;
    }

    gen_id() {
        return ++this._id;
    }
    sock() {
        return this._sock!;
    }

    private static _auth_method = new Map([
        ["mongodb_cr", async(db: MongoDb, username: string, password: string) => {
            let password_md5 = crypt.Md5.hashStr(`${username}:mongo:${password}`);
            let result = await db.run_command("getnoce");
            if (result.ok != 1) {
                return false;
            }

            let key = crypt.Md5.hashStr(result.nonce + username + password_md5);
            result = await db.run_command("authenticate", 1, "user", username, "nonce", result.nonce, "key", key);
            return result.ok == 1;
        }],
        ["scram_sha1", async (db: MongoDb, username: string, password: string) => {
            let user = username.replace(/=/g, "=3D").replace(/,/g, "=2C");
            let nonce = crypt.base64encode(crypt.randomkey());
            let first_bare = `n=${user},r=${nonce}`;
            let sasl_start_payload = btoa(`n,,${first_bare}`);
            let r = await db.run_command("saslStart", 1, "autoAuthorize", 1, "mechanism", "SCRAM-SHA-1", "payload", sasl_start_payload);
            if (r.ok != 1) {
                return false;
            }

            // r.conversationId;
            let parsed_s = atob(r.payload);
            let parsed_t: any = {};
            parsed_s.match(/(\w)=[^,]*/g)?.forEach((s) => {
                let pos = s.indexOf('=');
                parsed_t[s.slice(0, pos)] = s.slice(pos+1);
            });

            let iterations = Number(parsed_t["i"]);
            let salt = parsed_t["s"];
            let rnonce = parsed_t["r"];
            if (rnonce.indexOf(nonce) != 0) {
                skynet.error(`server returned an invalid nonce.`);
                return false;
            }
            
            let salt_password = (password: string, salt: Uint8Array, iter: number) => {
                let salt_new = new Uint8Array(salt.length + 4);
                salt_new.set(salt, 0);
                pack.encode_uint8(salt_new, salt.length + 3, 1);

                let output = crypt.hmac_sha1(salt_new, password);
                let inter = output;
                for (let i=2; i<=iter; i++) {
                    inter = crypt.hmac_sha1(inter, password);
                    crypt.xor(output, 0, output.length, inter);
                }
                return output;
            }

            let without_proof = `c=biws,r=${rnonce}`;
            let pbkdf2_key = crypt.Md5.hashStr(`${username}:mongo:${password}`);
            let salted_pass = salt_password(pbkdf2_key, crypt.base64decode(salt), iterations);
            let client_key = crypt.hmac_sha1("Client Key", salted_pass);
            let stored_key = crypt.sha1(client_key);
            let auth_msg = first_bare + "," + parsed_s + "," + without_proof;
            let client_sig = crypt.hmac_sha1(auth_msg, stored_key);
            crypt.xor(client_key, 0, client_key.length, client_sig);
            let client_key_xor_sig = client_key;
            let client_proof = "p=" + crypt.base64encode(client_key_xor_sig);
            let client_final = btoa(without_proof + "," + client_proof);
            let server_key = crypt.hmac_sha1("Server Key", salted_pass);
            let server_sig = crypt.base64encode(crypt.hmac_sha1(auth_msg, server_key));
            
            let conversationId = r.conversationId;
            r = await db.run_command("saslContinue", 1, "conversationId", conversationId, "payload", client_final);
            if (r.ok != 1) {
                return false;
            }

            parsed_s = atob(r.payload);
            parsed_t = {};
            parsed_s.match(/(\w)=[^,]*/g)?.forEach((s) => {
                let pos = s.indexOf('=');
                parsed_t[s.slice(0, pos)] = s.slice(pos+1);
            });

            if (parsed_t.v != server_sig) {
                skynet.error(`Server returned an invalid signature`);
                return false;
            }
            if (!r.done) {
                r = await db.run_command("saslContinue", 1, "conversationId", conversationId, "payload", "");
                if (r.ok != 1) {
                    return false;
                }
                if (!r.done) {
                    skynet.error("SASL conversation failed to complete");
                    return false;
                }
            }
            return true;
        }],
    ]);
    private _mongo_auth() {
        let auth_mod = this._target.authmod || "scram_sha1";
        return async (sock: socket_channel.Channel) => {
            if (this._target.username && this._target.password) {
                let auth = MongoClient._auth_method.get(auth_mod);
                skynet.assert(auth, "Invalid authmod");
                let ret = await auth!(this.get_db(this._target.authdb), this._target.username, this._target.password);
                skynet.assert(ret, "auth failed");
            }

            let rs_data = await this.get_db().run_command("ismaster");
            if (rs_data.ok == 1) {
                let parse_addr = (addr: string): [string, number] => {
                    let r = addr.match(/([^:]+):(.+)/);
                    if (!r) {
                        return ["", 0];
                    }
                    return [r[1], Number(r[2])];
                }
                if (rs_data.hosts) {
                    let backup: socket_channel.ADDRESS[] = [];
                    for (let v of rs_data.hosts) {
                        let [host, port] = parse_addr(v);
                        backup.push({host: host, port: port});
                    }

                    this.sock().change_backup(backup);
                }
                if (rs_data.ismaster) {
                    return;
                } else if (rs_data.primary) {
                    let [host, port] = parse_addr(rs_data.primary);
                    this.sock().change_host(host, port);
                } else  {
                    throw new Error(`No primary return: ${String(rs_data.me)}`);
                }
            }
        }
    }
};
