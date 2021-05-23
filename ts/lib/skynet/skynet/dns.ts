/*
--[[
	lua dns resolver library
	See  https://github.com/xjdrew/levent/blob/master/levent/dns.lua for more detail
--]]

-- [[
-- resource record type:
-- TYPE            value and meaning
-- A               1 a host address
-- NS              2 an authoritative name server
-- MD              3 a mail destination (Obsolete - use MX)
-- MF              4 a mail forwarder (Obsolete - use MX)
-- CNAME           5 the canonical name for an alias
-- SOA             6 marks the start of a zone of authority
-- MB              7 a mailbox domain name (EXPERIMENTAL)
-- MG              8 a mail group member (EXPERIMENTAL)
-- MR              9 a mail rename domain name (EXPERIMENTAL)
-- NULL            10 a null RR (EXPERIMENTAL)
-- WKS             11 a well known service description
-- PTR             12 a domain name pointer
-- HINFO           13 host information
-- MINFO           14 mailbox or mail list information
-- MX              15 mail exchange
-- TXT             16 text strings
-- AAAA            28 a ipv6 host address
-- SRV             33 a DNS RR for specifying the location of services
-- only appear in the question section:
-- AXFR            252 A request for a transfer of an entire zone
-- MAILB           253 A request for mailbox-related records (MB, MG or MR)
-- MAILA           254 A request for mail agent RRs (Obsolete - see MX)
-- *               255 A request for all records
--
-- resource recode class:
-- IN              1 the Internet
-- CS              2 the CSNET class (Obsolete - used only for examples in some obsolete RFCs)
-- CH              3 the CHAOS class
-- HS              4 Hesiod [Dyer 87]
-- only appear in the question section:
-- *               255 any class
-- ]]

--[[
-- struct header {
--  uint16_t tid     # identifier assigned by the program that generates any kind of query.
--  uint16_t flags   # flags
--  uint16_t qdcount # the number of entries in the question section.
--  uint16_t ancount # the number of resource records in the answer section.
--  uint16_t nscount # the number of name server resource records in the authority records section.
--  uint16_t arcount # the number of resource records in the additional records section.
-- }
--
-- request body:
-- struct request {
--  string name
--  uint16_t atype
--  uint16_t class
-- }
--
-- response body:
-- struct response {
--  string name
--  uint16_t atype
--  uint16_t class
--  uint16_t ttl
--  uint16_t rdlength
--  string rdata
-- }
--]]
*/

import * as skynet from "skynet";
import * as socket from "skynet/socket";
import { utf8 } from "utf8";
import {
    decode_str, 
    decode_uint16, 
    decode_uint32, 
    decode_uint8, 
    encode_uint16, 
    encode_uint8 
} from "pack";

const MAX_DOMAIN_LEN = 1024
const MAX_LABEL_LEN = 63
const DNS_HEADER_LEN = 12
const DNS_SERVER_RETIRE = 60 * 100
const MAX_TID = 65535

export let DNS_CONF = {
    DEFAULT_PORT: 53,
    DEFAULT_HOSTS: "/etc/hosts",
    DEFAULT_RESOLVE_CONF: "/etc/resolv.conf",
}

export enum QTYPE {
    A = 1,
    TXT = 16,
    AAAA = 28,
    SRV = 33,
}

enum NAME_TYPE {
    IPV4 = "ipv4",
    IPV6 = "ipv6",
    HOSTNAME = "hostname",
}
type LOCAL_HOSTS_FAMILY = NAME_TYPE.IPV4|NAME_TYPE.IPV6;
type LOCAL_HOSTS_MAP = Map<string, {[K in LOCAL_HOSTS_FAMILY]?: string[]}>;

//---------------------------------------------------
// util function
function guess_name_type(name: string) {
    if (name.match(/^[\d\.]+$/)) {
        return NAME_TYPE.IPV4;
    }
    if (name.indexOf(":") >= 0) {
        return NAME_TYPE.IPV6;
    }
    return NAME_TYPE.HOSTNAME;
}

function is_valid_hostname(name: string) {
    if (name.length > MAX_DOMAIN_LEN) {
        return false;
    }
    if (!name.match(/^[a-z\d\-\.\_]+$/)) {
        return false;
    }

    name.split(".").forEach((w) => {
        if (w.length > MAX_LABEL_LEN) {
            return false;
        }
    });

    return true;
}

function read_file(path: string) {
    try {
        let data = Deno.readTextFileSync(path);
        return data;
    } catch(e) {
        return;
    }
}

// http://man7.org/linux/man-pages/man5/hosts.5.html
function parse_hosts() {
    if (!DNS_CONF.DEFAULT_HOSTS) {
        return;
    }
    let content = read_file(DNS_CONF.DEFAULT_HOSTS);
    if (!content) {
        return;
    }
    let rts: LOCAL_HOSTS_MAP = new Map();
    content.split("\n").forEach((line) => {
        let r = line.match(/^\s*([A-Fa-f0-9\[\]\.\:]+)\s+([^#;]+)/)
        if (!r) {
            return;
        }

        let ip = r[1];
        let hosts = r[2];
        if (!ip || !hosts) {
            return;
        }
        let family = guess_name_type(ip);
        if (family == NAME_TYPE.HOSTNAME) {
            return;
        }
        
        hosts.split(/\s/).forEach((host) => {
            host = host.toLowerCase();
            let rt = rts.get(host) || {};
            rts.set(host, rt);

            let ips = rt[family as LOCAL_HOSTS_FAMILY] || [];
            rt[family as LOCAL_HOSTS_FAMILY] = ips;
            ips.push(ip);
        })
    })

    return rts;
}

// http://man7.org/linux/man-pages/man5/resolv.conf.5.html
function parse_resolve_conf() {
    if (!DNS_CONF.DEFAULT_RESOLVE_CONF) {
        return;
    }
    let content = read_file(DNS_CONF.DEFAULT_RESOLVE_CONF);
    if (!content) {
        return;
    }

    let servers = new Array<DNS_SERVER>();
    content.split("\n").forEach((line) => {
        let r = line.match(/^\s*nameserver\s+([^#;\s]+)/)
        if (r) {
            servers.push({host: r[1], port: DNS_CONF.DEFAULT_PORT});
        }        
    })
    return servers;
}

//---------------------------------------------------
// dns protocol
enum QCLASS {
    IN = 1,
}

enum SECTION {
    AN = 1,
    NS = 2,
    AR = 3,
}

type HEADER = {
    tid: number,
    flags: number,
    qdcount: number,
    ancount?: number,
    nscount?: number,
    arcount?: number,
}

type ANSWER_ITEM = {
    name: string,
    section: number,
    qtype: number,
    class: number,
    ttl: number,
    txt?: string[],
    address?: string,
    target?: string,
    priority?: number,
    weight?: number,
    port?: number,
}
type ANSWER = {
    tid: number,
    code: number,
    qname: string,
    qtype: number,
    anss: ANSWER_ITEM[],
}

function pack_header(t: HEADER) {
    let buffer = new Uint8Array(12);
    let offset = 0;
    encode_uint16(buffer, offset, t.tid); offset += 2;
    encode_uint16(buffer, offset, t.flags); offset += 2;
    encode_uint16(buffer, offset, t.qdcount); offset += 2;
    encode_uint16(buffer, offset, t.ancount || 0); offset += 2;
    encode_uint16(buffer, offset, t.nscount || 0); offset += 2;
    encode_uint16(buffer, offset, t.arcount || 0); offset += 2;
    return buffer;
}

function pack_question(name: string, qtype: QTYPE, qclass: QCLASS) {
    let labels = name.split(".");
    let label_len = 0;
    labels.forEach((label) => {
        label_len += 1 + label.length;
    });

    let buffer = new Uint8Array(label_len + 1 + 4);
    let offset = 0;
    labels.forEach((label) => {
        encode_uint8(buffer, offset, label.length);
        utf8.write(label, buffer, offset + 1);
        offset += 1 + label.length;
    });
    encode_uint8(buffer, offset++, 0);
    encode_uint16(buffer, offset, qtype); offset += 2;
    encode_uint16(buffer, offset, qclass); offset += 2;
    return buffer;
}

function unpack_name(chunk: Uint8Array, left: number): [string, number] {
    let t = new Array<string>();
    let jump_pointer;
    let tag, offset, label;
    while (true) {
        tag = decode_uint8(chunk, left); left += 1;
        if ((tag & 0xc0) == 0xc0) {
            offset = decode_uint16(chunk, left - 1); left += 1;
            offset = offset & 0x3fff;
            if (jump_pointer === undefined) {
                jump_pointer = left;
            }

            left = offset;
        } else if (tag == 0) {
            break;
        } else {
            [label, left] = decode_str(chunk, left - 1, 1);
            t.push(label);
        }
    }
    return [t.join("."), jump_pointer || left];
}

let unpack_type = new Map<QTYPE, (ans: ANSWER_ITEM, chunk: Uint8Array, sz: number) => void>([
    [
        QTYPE.A,
        (ans: ANSWER_ITEM, chunk: Uint8Array, sz: number) => {
            if (sz != 4) {
                throw new Error(`bad A record value length: ${sz}`);
            }
            let [a, b, c, d] = [chunk[0], chunk[1], chunk[2], chunk[3]];
            ans.address = `${a}.${b}.${c}.${d}`;
        }
    ],
    [
        QTYPE.AAAA,
        (ans: ANSWER_ITEM, chunk: Uint8Array, sz: number) => {
            if (sz != 16) {
                throw new Error(`bad AAAA record value length: ${sz}`);
            }
            let [a, b, c, d, e, f, g, h] = [
                decode_uint16(chunk, 0),
                decode_uint16(chunk, 2),
                decode_uint16(chunk, 4),
                decode_uint16(chunk, 6),
                decode_uint16(chunk, 8),
                decode_uint16(chunk, 10),
                decode_uint16(chunk, 12),
                decode_uint16(chunk, 14),
            ];
            ans.address = `${a}:${b}:${c}:${d}:${e}:${f}:${g}:${h}`;
        }
    ],
    [
        QTYPE.SRV,
        (ans: ANSWER_ITEM, chunk: Uint8Array, sz: number) => {
            if (sz < 7) {
                throw new Error(`bad SRV record value length: ${sz}`);
            }
            [ans.priority, ans.weight, ans.port] = [
                decode_uint16(chunk, 0),
                decode_uint16(chunk, 2),
                decode_uint16(chunk, 4),
            ];
            [ans.target] = unpack_name(chunk, 6);
        }
    ],
    [
        QTYPE.TXT,
        (ans: ANSWER_ITEM, chunk: Uint8Array, sz: number) => {
            ans.txt = [];
            let left = 0;
            while (left < sz) {
                let r;
                [r, left] = decode_str(chunk, left, 1);
                ans.txt.push(r);
            }
            return;
        }
    ],
]);

function unpack_section(answers: ANSWER_ITEM[], section: number, chunk: Uint8Array, left: number, count: number) {
    for (let i = 0; i < count; i++) {
        let name;
        [name, left] = unpack_name(chunk, left);

        let ans: ANSWER_ITEM = {
            section: section,
            name: name,
            qtype: decode_uint16(chunk, left),
            class: decode_uint16(chunk, left + 2),
            ttl: decode_uint32(chunk, left + 4),
        };
        left += 2+2+4;

        let len = decode_uint16(chunk, left);
        let unpack_rdata = unpack_type.get(ans.qtype);
        if (unpack_rdata) {
            unpack_rdata(ans, chunk.subarray(left + 2, left + 2 + len), len);
            answers.push(ans);
        }
        left += 2 + len;
    }
    return left;
}

function unpack_response(chunk: Uint8Array, sz: number, response: (tid?: number, answers?: ANSWER, error?: string) => void) {
    if (sz < DNS_HEADER_LEN) {
        return response(undefined, undefined, "truncated");
    }

    let left = 0;
    let [tid, flags, qdcount, ancount, nscount, arcount] = [
        decode_uint16(chunk, left + 0),
        decode_uint16(chunk, left + 2),
        decode_uint16(chunk, left + 4),
        decode_uint16(chunk, left + 6),
        decode_uint16(chunk, left + 8),
        decode_uint16(chunk, left + 10),
    ];
    left += 12;
    if ((flags & 0x8000) == 0) {
        return response(tid, undefined, "bad QR flag in the DNS response");
    }
    if ((flags & 0x200) != 0) {
        return response(tid, undefined, "truncated");
    }
    let code = flags & 0xf;
    if (code != 0) {
        return response(tid, undefined, `code: ${code}`);
    }

    if (qdcount != 1) {
        return response(tid, undefined, `qdcount error ${qdcount}`);
    }
    let qname;
    [qname, left] = unpack_name(chunk, left);
    let qtype = decode_uint16(chunk, left); left += 2;
    let qclass = decode_uint16(chunk, left); left += 2;
    let answers = {
        tid,
        code,
        qname,
        qtype,
        anss: new Array<ANSWER_ITEM>(),
    };

    let sections = [
        { section: SECTION.AN, count: ancount },
        { section: SECTION.NS, count: nscount },
        { section: SECTION.AR, count: arcount },
    ];
    try {
        for (let section of sections) {
            left = unpack_section(answers.anss, section.section, chunk, left, section.count);
        }
        return response(tid, answers);
    } catch (e) {
        return response(tid, undefined, e.message);
    }
}

//---------------------------------------------------
type REQUEST = {
    name: string,
    tid: number,
    token: number,
    result?: ANSWER,
    error?: string,
}
type DNS_SERVER = {
    host: string,
    port: number,
    udp?: number,
    retire?: number,
}
let next_tid = 1;
let request_pool = new Map<number, REQUEST>();
let dns_servers: Array<DNS_SERVER>|undefined;
let dns_addrs: DNS_SERVER[]|undefined;

function gen_tid() {
    let tid = next_tid;
    if (request_pool.has(tid)) {
        tid = -1;
        for (let i = 0; i < MAX_TID - 1; i++) {
            let slot = (i + next_tid) % MAX_TID + 1;
            if (!request_pool.has(slot)) {
                tid = slot;
                break;
            }
        }
        skynet.assert(tid >= 0);
    }

    next_tid = tid + 1;
    if (next_tid > MAX_TID) {
        next_tid = 1;
    }
    return tid;
}

function response(tid?: number, result?: ANSWER, error?: string) {
    let req = request_pool.get(tid!);
    if (!req) {
        return `not exists tid ${tid}`;
    }

    req.result = result;
    req.error = error;

    if (req.token) {
        skynet.wakeup(req.token);
    }
}

function get_dns_servers() {
    if (dns_servers) {
        return dns_servers;
    }

    if (!dns_addrs) {        
        dns_addrs = parse_resolve_conf();
        skynet.assert(dns_addrs && dns_addrs.length, "parse resolve conf failed");
    }

    dns_servers = [];
    dns_addrs!.forEach((s) => {
        dns_servers!.push({
            host: s.host,
            port: s.port,
        })
    })
    return dns_servers;
}
function set_dns_servers(servers: DNS_SERVER[]) {
    dns_servers = servers;
}

async function select_server(server: DNS_SERVER) {
    if (server.retire) {
        server.retire = skynet.now() + DNS_SERVER_RETIRE;
        return server;
    }

    let udp = socket.udp((data: Uint8Array, sz: number, address: string) => {
        unpack_response(data, sz, response);
    });
    socket.udp_connect(udp, server.host, server.port);
    skynet.error(`dns open nameserver ${server.host}:${server.port} (${udp})`);
    server.udp = udp;
    server.retire = skynet.now() + DNS_SERVER_RETIRE;

    let check_alive = async () => {
        while (true) {
            if (skynet.now() > server.retire!) {
                skynet.error(`dns retire nameserver ${server.host}:${server.port} (${udp})`);
                socket.close(server.udp!);
                server.udp = undefined;
                server.retire = undefined;
                break;
            }
            await skynet.sleep(2 * DNS_SERVER_RETIRE);
        }
    }
    check_alive();
    return server
}

async function udp_query(server: DNS_SERVER, tid: number, qname: string, data: Uint8Array[], timeout: number): Promise<[ANSWER?, string?]> {
    skynet.assert(server.udp);
    socket.write(server.udp!, data);
    let req: REQUEST = {
        name: qname,
        tid: tid,
        token: skynet.gen_token(),
    };
    request_pool.set(tid, req);
    let check = async () => {
        await skynet.sleep(timeout);
        let r = request_pool.get(tid);
        if (r) {
            request_pool.delete(tid);
            r.error = "timeout";
            skynet.wakeup(r.token);
        }
    };
    check();
    await skynet.wait(req.token);
    request_pool.delete(tid);
    return [req.result, req.error]
}

function tcp_release(tid: number, fd: number) {
    request_pool.delete(tid);
    socket.close(fd);
}
async function tcp_query(server: DNS_SERVER, tid: number, qname: string, data: Uint8Array[], timeout: number): Promise<[ANSWER?, string?]> {
    let fd = await socket.open(server.host, server.port);
    if (!fd) {
        return [undefined, "connect failed"];
    }
    let data_len = 0;
    data.forEach((d) => data_len += d.length);
    let header = new Uint8Array(2);
    encode_uint16(header, 0, data_len);
    socket.write(fd, [header, ...data]);

    let req: REQUEST = {
        name: qname,
        tid: tid,
        token: 0,
    };
    request_pool.set(tid, req);
    let check = async () => {
        await skynet.sleep(timeout);
        let r = request_pool.get(tid);
        if (r) {
            let old_fd = fd;
            fd = 0;
            r.error = "timeout";
            tcp_release(tid, old_fd);
        }
    };
    check();

    let [header_ok, header_chunk, header_sz] = await socket.read(fd, 2);
    if (!header_ok) {
        tcp_release(tid, fd);
        return [undefined, req.error || "closed"];
    }

    let len = decode_uint16(header_chunk!, 0);
    let [ok, chunk, sz] = await socket.read(fd, len);
    if (!ok) {
        tcp_release(tid, fd);
        return [undefined, req.error || "closed"];
    }

    try {
        unpack_response(chunk!, sz!, response);
    } finally {
        tcp_release(tid, fd);
        return [req.result, req.error];
    }
}

//-------------------------------------------------------------------
// cached
let cached: any = {};
function query_cache(qtype: number, name: string) {
    let qcache = cached[qtype];
    if (!qcache) {
        return;
    }

    let t = qcache[name];
    if (t) {
        if (t.expired < skynet.now()) {
            qcache[name] = undefined;
            return;
        }
        return t.data;
    }
}

function set_cache(qtype: number, name: string, ttl: number, data: any) {
    if (ttl && data) {
        let qcache = cached[qtype];
        if (!qcache) {
            qcache = {};
            cached[qtype] = qcache;
        }
        qcache[name] = {
            expired: skynet.now() + ttl * 100,
            data: data,
        }
    }
}

//-------------------------------------------------------------------
type SERVER_SRV = {
    name: string,
    host: string,
    port: number,
    weight: number,
    priority: number,
    ttl: number,
}
interface RESOLVE_RESULT {
    [QTYPE.A]: {ttl: number, address: string, results: string[]},
    [QTYPE.AAAA]: {ttl: number, address: string, results: string[]},
    [QTYPE.SRV]: {ttl: number, results: SERVER_SRV[]},
    [QTYPE.TXT]: {ttl: number, results: string[]},
}
type StronglyKeyedMap<T, K extends keyof T, V> = { [k in K]: V };

let resolve_type: StronglyKeyedMap<
    RESOLVE_RESULT, 
    keyof RESOLVE_RESULT,
    {family?: LOCAL_HOSTS_FAMILY, normalize: (answers: ANSWER) => RESOLVE_RESULT[keyof RESOLVE_RESULT]}
> = {
    [QTYPE.A]: {
        family: NAME_TYPE.IPV4,
        normalize: (answers: ANSWER) => {
            let results: string[] = [];
            let ttl: number;
            for (let ans of answers.anss) {
                if (ans.qtype == QTYPE.A) {
                    results.push(ans.address!);
                    ttl = ans.ttl;
                }
            }
            return {ttl: ttl!, address: results[0], results};
        },
    },
    [QTYPE.AAAA]: {
        family: NAME_TYPE.IPV6,
        normalize: (answers: ANSWER) => {
            let results: string[] = [];
            let ttl: number;
            for (let ans of answers.anss) {
                if (ans.qtype == QTYPE.AAAA) {
                    results.push(ans.address!);
                    ttl = ans.ttl;
                }
            }
            return {ttl: ttl!, address: results[0], results};
        },
    },
    [QTYPE.SRV]: {
        normalize: (answers: ANSWER) => {
            let servers = new Map<string, SERVER_SRV>();
            for (let ans of answers.anss) {
                if (ans.qtype == QTYPE.SRV) {
                    servers.set(ans.target!, {
                        name: ans.target!,
                        host: ans.target!,
                        port: ans.port!,
                        weight: ans.weight!,
                        priority: ans.priority!,
                        ttl: ans.ttl,
                    });
                } else if (ans.qtype == QTYPE.A || ans.qtype == QTYPE.AAAA) {
                    skynet.assert(servers.has(ans.name));
                    servers.get(ans.name)!.host = ans.address!;
                }
            }

            let ret: SERVER_SRV[] = [];
            let ttl: number;
            servers.forEach((s) => {
                ret.push(s);
                ttl = s.ttl;
            })
            return {results: ret, ttl: ttl!};
        },
    },
    [QTYPE.TXT]: {
        normalize: (answers: ANSWER) => {
            let results: string[] = [];
            let ttl: number;
            for (let ans of answers.anss) {
                if (ans.qtype == QTYPE.TXT) {
                    for (let txt of ans.txt!) {
                        results.push(txt);
                    }
                    ttl = ans.ttl;
                }
            }
            return {results: results, ttl: ttl!};
        },
    }
}

let local_hosts: LOCAL_HOSTS_MAP;
function local_resolve(name: string, qtype: QTYPE) {
    if (!local_hosts) {
        local_hosts = parse_hosts()!;
        skynet.assert(local_hosts, "parse hosts file failed");
    }
    
    let family = resolve_type[qtype].family!;
    let local = local_hosts.get(name);
    if (local) {
        return local[family];
    }
}

function pack_request(tid: number, name: string, qtype: QTYPE) {
    let header: HEADER = {
        tid: tid,
        flags: 0x100,
        qdcount: 1,
    }
    return [pack_header(header), pack_question(name, qtype, QCLASS.IN)];
}

async function remote_resolve<K extends keyof RESOLVE_RESULT>(name: string, qtype: K, timeout: number): Promise<[RESOLVE_RESULT[K]?, string?]> {
    let ret = query_cache(qtype, name);
    if (ret) {
        return [ret];
    }

    let nameservers = get_dns_servers();
    let valid_nameserver: DNS_SERVER[] = [];
    let valid_amount = 0;
    let result, err, tid;

    for (let server of nameservers) {
        if (!result) {
            tid = gen_tid();
            [result, err] = await udp_query(await select_server(server), tid, name, pack_request(tid, name, qtype), timeout);
            if (err == "truncated") {
                tid = gen_tid();
                [result, err] = await tcp_query(await select_server(server), tid, name, pack_request(tid, name, qtype), timeout);
            }
        }

        if (err == "timeout") {
            valid_nameserver.splice(valid_nameserver.length, 0, server);
        } else {
            valid_nameserver.splice(valid_amount++, 0, server);
        }
    }
    set_dns_servers(valid_nameserver);

    if (!result) {
        return [undefined, err];
    } else if (result.anss.length == 0) {
        return [undefined, "noanswers"];
    }

    let r = resolve_type[qtype]?.normalize(result);
    set_cache(qtype, name, r!.ttl, r);

    return [r as RESOLVE_RESULT[K]];
}

async function dns_resolve(name: string, qtype: QTYPE, timeout: number) {
    skynet.assert(resolve_type[qtype]);
    let l = local_resolve(name, qtype);
    if (l) {
        return [{address: l[0], results: l}];
    }

    return await remote_resolve(name, qtype, timeout);
}

export function set_servers(servers?: { host: string, port?: number }[]) {
    dns_servers = undefined;
    if (!servers) {
        dns_addrs = undefined;
        return;
    }

    dns_addrs = [];
    for (let server of servers) {
        dns_addrs.push({
            host: server.host,
            port: server.port || DNS_CONF.DEFAULT_PORT
        })
    }
}

export function set_server(host?: string, port?: number) {
    if (host) {
        set_servers([{ host, port }]);
    } else {
        set_servers(); // reload resolve
    }
}

export async function resolve<K extends keyof RESOLVE_RESULT>(name: string, qtype: K = QTYPE.A as K, timeout: number = 100): Promise<[RESOLVE_RESULT[K]?, string?]> {
    name = name.toLowerCase();
    let ntype = guess_name_type(name);

    if (ntype != NAME_TYPE.HOSTNAME) {
        return [{address: name} as RESOLVE_RESULT[K]]
    }

    if (!is_valid_hostname(name)) {
        return [undefined, "illegal name"];
    }
    let r = (await dns_resolve(name, qtype, timeout)) as [RESOLVE_RESULT[K]?, string?];
    return r;
}
