import { utf8 } from "utf8"

const TYPE_NIL = 0
const TYPE_BOOLEAN = 1
// hibits 0 false 1 true
const TYPE_NUMBER = 2
// hibits 0 : 0 , 1: byte, 2:word, 4: dword, 6: qword, 8 : double
const TYPE_NUMBER_ZERO = 0
const TYPE_NUMBER_BYTE = 1
const TYPE_NUMBER_WORD = 2
const TYPE_NUMBER_DWORD = 4
const TYPE_NUMBER_QWORD = 6
const TYPE_NUMBER_REAL = 8

const TYPE_USERDATA = 3
const TYPE_SHORT_STRING = 4
// hibits 0~31 : len
const TYPE_LONG_STRING = 5
const TYPE_TABLE = 6

const MAX_DEPTH = 100;
const BLOCK_BUFFER_SIZE = 128;
const MAX_COOKIE = 32;

type BLOCK_TYPE = {pos: number, view: DataView, bytes: Uint8Array};
class encoder {
    blocks: BLOCK_TYPE[] = [];
    cur_blocks?: BLOCK_TYPE;
    constructor() {
    }

    serialize() {
        if (!this.blocks.length) {
            return null;
        }
        let blocks = [];
        for (let b of this.blocks) {
            blocks.push(b.bytes.subarray(0, b.pos));
        }        
        return blocks;
    }
    
    ensure_write_size(sz: number) {
        if (!this.cur_blocks || (this.cur_blocks.bytes.length - this.cur_blocks.pos) < sz) {
            this.alloc_block();
        }
    }

    alloc_block() {
        let view = new DataView(new ArrayBuffer(BLOCK_BUFFER_SIZE));
        let block = {
            pos: 0,
            view: view,
            bytes: new Uint8Array(view.buffer)
        };

        this.cur_blocks = block;
        this.blocks.push(block);
        return block;
    }

    encode(object: any, depth = 0) {
        if (depth > MAX_DEPTH) {
            throw new Error(`too deep objects in depth ${depth}`)
        }

        let type = typeof(object)
        if (object == null) {
            this.encode_nil();
        } else if (type == "boolean") {
            this.encode_boolean(object);
        } else if (type == "string") {
            this.encode_string(object);
        } else if (type == "number") {
            this.encode_number(object);
        } else if (type == "object") {
            this.encode_object(object, depth+1);
        } else {
            throw new Error(`unsupport type: ${type} to serialize`);
        }
    }

    encode_nil() {
        this.write_u8(TYPE_NIL);
    }
    encode_boolean(v: boolean) {
        this.write_u8(this.combin_type(TYPE_BOOLEAN, v ? 1 : 0));
    }
    encode_number(v: number) {
        if (Number.isSafeInteger(v)) {
            if (v == 0) {
                this.write_u8(this.combin_type(TYPE_NUMBER, TYPE_NUMBER_ZERO));
            } else if (v < -2147483648 || v > 2147483648) {
                this.write_u8(this.combin_type(TYPE_NUMBER, TYPE_NUMBER_QWORD));
                this.write_f64(v);
            } else if (v < 0) {
                this.write_u8(this.combin_type(TYPE_NUMBER, TYPE_NUMBER_DWORD));
                this.write_i32(v);
            } else if (v < 0x100) {
                this.write_u8(this.combin_type(TYPE_NUMBER, TYPE_NUMBER_BYTE));
                this.write_u8(v);
            } else if (v < 0x10000) {
                this.write_u8(this.combin_type(TYPE_NUMBER, TYPE_NUMBER_WORD));
                this.write_u16(v);
            } else {
                this.write_u8(this.combin_type(TYPE_NUMBER, TYPE_NUMBER_DWORD));
                this.write_i32(v);
            }    
        } else {
            this.write_u8(this.combin_type(TYPE_NUMBER, TYPE_NUMBER_REAL));
            this.write_f64(v);
        }
    }
    encode_string(v: string) {
        let len = utf8.length(v);
        if (len < MAX_COOKIE) {
            this.write_u8(this.combin_type(TYPE_SHORT_STRING, len));
        } else if (len < 0x10000) {
            this.write_u8(this.combin_type(TYPE_LONG_STRING, 2));
            this.write_u16(len);
        } else {
            this.write_u8(this.combin_type(TYPE_LONG_STRING, 4));
            this.write_u32(len);
        }
        if (len) {
            this.write_string(v);
        }
    }
    encode_object(v: any, depth: number) {
        if (Array.isArray(v)) {
            let array_size = v.length;
            if (array_size >= MAX_COOKIE - 1) {
                this.write_u8(this.combin_type(TYPE_TABLE, MAX_COOKIE-1));
                this.encode_number(array_size);
            } else {
                this.write_u8(this.combin_type(TYPE_TABLE, array_size));
            }

            for (let i = 0; i < array_size; i++) {
                this.encode(v[i], depth);
            }
            
            this.encode_nil();
        } else {
            this.write_u8(this.combin_type(TYPE_TABLE, 0));
            for (let k in v) {
                this.encode(k, depth);
                this.encode(v[k], depth);
            }
            this.encode_nil();
        }
    }

    combin_type(t: number, v: number) {
        return t | (v << 3)
    }
    write_u8(v: number) {
        this.ensure_write_size(1);
        
        this.cur_blocks!.view.setUint8(this.cur_blocks!.pos, v);
        this.cur_blocks!.pos++;
    }
    write_i16(v: number) {
        this.ensure_write_size(2);
        this.cur_blocks!.view.setInt16(this.cur_blocks!.pos, v, true);
        this.cur_blocks!.pos += 2;
    }
    write_u16(v: number) {
        this.ensure_write_size(2);
        this.cur_blocks!.view.setUint16(this.cur_blocks!.pos, v, true);
        this.cur_blocks!.pos += 2;
    }
    write_i32(v: number) {
        this.ensure_write_size(4);
        this.cur_blocks!.view.setInt32(this.cur_blocks!.pos, v, true);
        this.cur_blocks!.pos += 4;
    }
    write_u32(v: number) {
        this.ensure_write_size(4);
        this.cur_blocks!.view.setUint32(this.cur_blocks!.pos, v, true);
        this.cur_blocks!.pos += 4;
    }
    write_f64(v: number) {
        this.ensure_write_size(8);
        this.cur_blocks!.view.setFloat64(this.cur_blocks!.pos, v, true);
        this.cur_blocks!.pos += 8;
    }
    write_string(v: string) {
        let pos = 0;
        while (pos < v.length) {
            let cur_block = this.cur_blocks;
            if (!cur_block) {
                this.alloc_block();
                continue;
            }

            let space = cur_block.bytes.length - cur_block.pos;
            if (!space) {
                this.alloc_block();
                continue;
            }

            let write_len = 0;
            [write_len, pos] = utf8.write(v, cur_block.bytes, cur_block.pos, pos);
            if (write_len == 0) {
                this.alloc_block();
                continue;
            }
            cur_block.pos += write_len;
        }
    }
}

class decoder {
    pos = 0;
    sz = 0;
    view?: DataView;
    bytes?: Uint8Array;
    constructor(buffer: Uint8Array, sz: number) {
        this.pos = 0;
        this.sz = sz;
        if (buffer && buffer.length) {
            this.view = new DataView(buffer.buffer);
            this.bytes = new Uint8Array(this.view.buffer);
        }
    }

    decode() {
        if (!this.bytes) {
            return [];
        }

        let result = []
        while (this.pos < this.sz) {
            result.push(this.decode_one())
        }

        return result;
    }

    decode_one(): any {
        let type = this.read_u8();
        let subtype = type >> 3;
        type = type & 0x7;

        if (type == TYPE_NIL) {
            return null;
        } else if (type == TYPE_BOOLEAN) {
            return subtype ? true : false;            
        } else if (type == TYPE_NUMBER) {
            return this.decode_number(subtype);
        } else if (type == TYPE_SHORT_STRING) {
            return this.read_string(subtype);
        } else if (type == TYPE_LONG_STRING) {
            let len = 0;
            if (subtype == 2) {
                len = this.read_u16();
            } else {
                len = this.read_u32();
            }
            return this.read_string(len);
        } else if (type == TYPE_TABLE) {
            let len = subtype;
            if (subtype >= MAX_COOKIE - 1) {
                len = this.decode_one();
            }

            if (len > 0) {
                let v = [];
                for (let i=0; i<len; i++) {
                    v.push(this.decode_one());
                }
                do {
                    let type = this.look_u8() & 0x7;
                    if (type == TYPE_NIL) {
                        this.read_u8();
                        break;
                    }
                    
                    let k = this.decode_one();
                    v[k] = this.decode_one();
                } while (true);

                return v;
            } else {
                let v: any = {};
                do {
                    let type = this.look_u8() & 0x7;
                    if (type == TYPE_NIL) {
                        this.read_u8();
                        break;
                    }
                    
                    let k = this.decode_one();
                    v[k] = this.decode_one();
                } while (true);
                return v;
            }
        }
    }
    decode_number(subtype: number) {
        if (subtype == TYPE_NUMBER_ZERO) {
            return 0;
        } else if (subtype == TYPE_NUMBER_BYTE) {
            return this.read_u8();
        } else if (subtype == TYPE_NUMBER_WORD) {
            return this.read_u16();
        } else if (subtype == TYPE_NUMBER_DWORD) {
            return this.read_i32();
        } else if (subtype == TYPE_NUMBER_QWORD) {
            return this.read_f64();
        } else if (subtype == TYPE_NUMBER_REAL) {
            return this.read_f64();
        }
    }

    ensure_read_size(sz: number) {
        if (!this.bytes || (this.sz - this.pos) < sz) {
            throw new Error(`invalid serialize stream ${sz} ${this.bytes!.length} ${this.pos}`);
        }
    }
    look_u8() {
        this.ensure_read_size(1);
        return this.view!.getUint8(this.pos);
    }
    read_u8() {
        this.ensure_read_size(1);
        return this.view!.getUint8(this.pos++);
    }
    read_u16() {
        this.ensure_read_size(2);
        let v = this.view!.getUint16(this.pos, true);
        this.pos += 2;
        return v;
    }
    read_i32() {
        this.ensure_read_size(4);
        let v = this.view!.getInt32(this.pos, true);
        this.pos += 4;
        return v;
    }
    read_u32() {
        this.ensure_read_size(4);
        let v = this.view!.getUint32(this.pos, true);
        this.pos += 4;
        return v;
    }
    read_f64() {
        this.ensure_read_size(8);
        let v = this.view!.getFloat64(this.pos, true);
        this.pos += 8;
        return v;
    }
    read_string(len: number) {
        this.ensure_read_size(len);
        let v = utf8.read(this.bytes!, this.pos, this.pos + len);
        this.pos += len;
        return v;
    }
}

function encode(...datas: any) {
    let wb = new encoder();
    for (let d of datas) {
        wb.encode(d);
    }
    return wb.serialize();
}

function decode(buffer: Uint8Array, sz: number) {
    return new decoder(buffer, sz).decode();
}

export {
    encode,
    decode,
}