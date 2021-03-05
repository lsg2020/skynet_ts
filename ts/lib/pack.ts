import { utf8 } from "utf8";

export function decode_uint8(chunk: Uint8Array, offset: number, is_le?: boolean) {
    return chunk[offset];
}
export function decode_int8(chunk: Uint8Array, offset: number, is_le?: boolean) {
    return uncomplement(chunk[offset], 8);
}
export function decode_uint16(chunk: Uint8Array, offset: number, is_le?: boolean) {
    if (is_le)
        return (chunk[offset+1] << 8) | (chunk[offset]);
    else
        return (chunk[offset] << 8) | (chunk[offset + 1]);
}
export function decode_int16(chunk: Uint8Array, offset: number, is_le?: boolean) {
    if (is_le)
        return uncomplement((chunk[offset+1] << 8) | (chunk[offset]), 16);
    else
        return uncomplement((chunk[offset] << 8) | (chunk[offset + 1]), 16);
}
export function decode_uint32(chunk: Uint8Array, offset: number, is_le?: boolean) {
    return decode_uint(chunk, offset, 4, is_le);
}
export function decode_int32(chunk: Uint8Array, offset: number, is_le?: boolean) {
    return uncomplement(decode_uint(chunk, offset, 4, is_le), 32);
}
export function decode_uint(chunk: Uint8Array, offset: number, n: number, is_le?: boolean): number {
    if (is_le) {
        let r = 0;
        while (n-- > 0) {
            r = (r * 256) + chunk[offset + n];
        }
        return r;
    } else  {
        let r = 0;
        while (n-- > 0) {
            r = (r * 256) + chunk[offset++];
        }
        return r;
    }
}
export function decode_biguint(chunk: Uint8Array, offset: number, n: number, is_le?: boolean): bigint {
    if (is_le) {
        let bitwidth = BigInt(n * 8);
        let r = 0n;
        while (n-- > 0) {
            r = (r * 256n) + BigInt(chunk[offset + n]);
        }
        return r;    
    } else {
        let bitwidth = BigInt(n * 8);
        let r = 0n;
        while (n-- > 0) {
            r = (r * 256n) + BigInt(chunk[offset++]);
        }
        return r;
    }
}
export function decode_bigint(chunk: Uint8Array, offset: number, n: number, is_le?: boolean): bigint {
    let bitwidth = BigInt(n * 8);
    return uncomplement_bigint(decode_biguint(chunk, offset, n, is_le), bitwidth);
}
export function decode_float(chunk: Uint8Array, offset: number, is_le?: boolean) {
    return readIEEE754(chunk, offset, is_le ? true : false, 23, 4);
}
export function decode_double(chunk: Uint8Array, offset: number, is_le?: boolean) {
    return readIEEE754(chunk, offset, is_le ? true : false, 52, 8);
}

export function decode_str(chunk: Uint8Array, offset: number, n: number, is_le?: boolean): [string, number] {
    let len = decode_uint(chunk, offset, n, is_le);
    let str = utf8.read(chunk, offset + n, offset + n + len);
    return [str, offset + n + len];
}

export function sub_str(buffer: Uint8Array, start?: number, end?: number) {
    return String.fromCharCode.apply(null, Array.from(buffer.subarray(start, end)))
}

export function encode_uint8(chunk: Uint8Array, offset: number, value: number, is_le?: boolean) {
    chunk[offset] = value;
}
export function encode_int8(chunk: Uint8Array, offset: number, value: number, is_le?: boolean) {
    chunk[offset] = value;
}
export function encode_uint16(chunk: Uint8Array, offset: number, value: number, is_le?: boolean) {
    if (is_le) {
        chunk[offset + 1] = (value >> 8) & 0xff;
        chunk[offset] = value & 0xff;    
    } else {
        chunk[offset] = (value >> 8) & 0xff;
        chunk[offset + 1] = value & 0xff;    
    }
}
export function encode_int16(chunk: Uint8Array, offset: number, value: number, is_le?: boolean) {
    if (is_le) {
        chunk[offset + 1] = (value >> 8) & 0xff;
        chunk[offset] = value & 0xff;    
    } else {
        chunk[offset] = (value >> 8) & 0xff;
        chunk[offset + 1] = value & 0xff;    
    }
}
export function encode_uint32(chunk: Uint8Array, offset: number, value: number, is_le?: boolean) {
    if (is_le) 
        encode_uint(chunk, offset, value, 4, true);
    else
        encode_uint(chunk, offset, value, 4, false);
}
export function encode_int32(chunk: Uint8Array, offset: number, value: number, is_le?: boolean) {
    if (is_le) 
        encode_uint(chunk, offset, value, 4, true);
    else
        encode_uint(chunk, offset, value, 4, false);
}
export function encode_safe_uint64(chunk: Uint8Array, offset: number, value: number, is_le?: boolean) {
    if (is_le) 
        encode_uint(chunk, offset, value, 8, true);
    else
        encode_uint(chunk, offset, value, 8, false);
}
export function encode_safe_int64(chunk: Uint8Array, offset: number, value: number, is_le?: boolean) {
    if (is_le) 
        encode_uint(chunk, offset, value, 8, true);
    else
        encode_uint(chunk, offset, value, 8, false);
}
export function encode_uint(chunk: Uint8Array, offset: number, value: number, n: number, is_le?: boolean) {
    if (is_le) {
        while (n-- > 0) {
            chunk[offset++] = value % 256;
            value = Math.floor(value / 256);
        }    
    } else {
        while (n-- > 0) {
            chunk[offset + n] = value % 256;
            value = Math.floor(value / 256);
        }    
    }
}
export function encode_bigint(chunk: Uint8Array, offset: number, value: bigint, n: number, is_le?: boolean) {
    if (is_le) {
        while (n-- > 0) {
            chunk[offset++] = Number(value % 256n);
            value = value / 256n;
        }
    } else {
        while (n-- > 0) {
            chunk[offset + n] = Number(value % 256n);
            value = value / 256n;
        }    
    }
}
export function encode_float(chunk: Uint8Array, offset: number, value: number, is_le?: boolean) {
    return writeIEEE754(chunk, value, offset, is_le ? true : false, 23, 4);
}
export function encode_double(chunk: Uint8Array, offset: number, value: number, is_le?: boolean) {
    return writeIEEE754(chunk, value, offset, is_le ? true : false, 52, 8);
}

export function encode_cstring(chunk: Uint8Array, offset: number, value: string) {
    let [sz] = utf8.write(value, chunk, offset);
    chunk[offset + sz] = 0;
    return offset + sz + 1;
}

export function encode_buf(chunk: Uint8Array, offset: number, value: Uint8Array, n: number, is_le?: boolean) {
    if (n) {
        encode_uint(chunk, offset, value.length, n, is_le);
    }
    chunk.set(value, offset + n);
    return offset + value.length + n;
}

export class encoder {
    _buffer: Uint8Array;
    _pos = 0;
    constructor(buffer?: Uint8Array) {
            this._buffer = buffer || new Uint8Array(128);
    }

    private _ensure_write_sz(sz: number) {
        if (this._buffer.length < this._pos + sz) {
            let new_buffer = new Uint8Array((this._pos + sz) * 2);
            new_buffer.set(this._buffer);
            this._buffer = new_buffer;
        }
    }

    uint8(value: number, is_le?: boolean) {
        this._ensure_write_sz(1);
        encode_uint8(this._buffer, this._pos, value, is_le);
        this._pos += 1;
    }
    int8(value: number, is_le?: boolean) {
        this._ensure_write_sz(1);
        encode_int8(this._buffer, this._pos, value, is_le);
        this._pos += 1;
    }
    uint16(value: number, is_le?: boolean) {
        this._ensure_write_sz(2);
        encode_uint16(this._buffer, this._pos, value, is_le);
        this._pos += 2;
    }
    int16(value: number, is_le?: boolean) {
        this._ensure_write_sz(2);
        encode_int16(this._buffer, this._pos, value, is_le);
        this._pos += 2;
    }
    uint32(value: number, is_le?: boolean) {
        this._ensure_write_sz(4);
        encode_uint32(this._buffer, this._pos, value, is_le);
        this._pos += 4;
    }
    int32(value: number, is_le?: boolean) {
        this._ensure_write_sz(4);
        encode_int32(this._buffer, this._pos, value, is_le);
        this._pos += 4;
    }
    safe_uint64(value: number, is_le?: boolean) {
        this._ensure_write_sz(8);
        encode_safe_uint64(this._buffer, this._pos, value, is_le);
        this._pos += 8;
    }
    safe_int64(value: number, is_le?: boolean) {
        this._ensure_write_sz(8);
        encode_safe_int64(this._buffer, this._pos, value, is_le);
        this._pos += 8;
    }
    uint(value: number, n: number, is_le?: boolean) {
        this._ensure_write_sz(n);
        encode_uint(this._buffer, this._pos, value, n, is_le);
        this._pos += n;
    }
    bigint(value: bigint, n: number, is_le?: boolean) {
        this._ensure_write_sz(n);
        encode_bigint(this._buffer, this._pos, value, n, is_le);
        this._pos += n;
    }

    float(value: number, is_le?: boolean) {
        this._ensure_write_sz(4);
        encode_float(this._buffer, this._pos, value, is_le);
        this._pos += 4;
    }

    double(value: number, is_le?: boolean) {
        this._ensure_write_sz(8);
        encode_double(this._buffer, this._pos, value, is_le);
        this._pos += 8;
    }

    cstring(value: string) {
        this._ensure_write_sz(utf8.length(value) + 1);
        this._pos = encode_cstring(this._buffer, this._pos, value);
    }

    buffer(value: Uint8Array, n: number, le?: boolean) {
        this._ensure_write_sz(value.length + n);
        this._pos = encode_buf(this._buffer, this._pos, value, n, le);
    }

    utf8_str(value: string, n: number, le?: boolean) {
        let len = utf8.length(value);
        this._ensure_write_sz(len + n);
        if (n) {
            this.uint(len, n, le);
        }
        utf8.write(value, this._buffer, this._pos);
        this._pos += len;
    }

    utf8_cstr(value: string) {
        this.utf8_str(value, 0);
        this.reserve(1);
    }

    reserve(n: number) {
        let old_pos = this._pos;
        this._ensure_write_sz(n);
        for (let i = this._pos; i < this._pos + n; i++) {
            this._buffer[i] = 0;
        }
        this._pos += n;
        return old_pos;
    }

    finish(): Uint8Array {
        return this._buffer.subarray(0, this._pos);
    }
};

export class decoder {
    _buffer: Uint8Array;
    _pos: number;
    private _sz: number;

    constructor(buffer: Uint8Array, sz: number, pos: number = 0) {
        this._buffer = buffer;
        this._sz = sz;
        this._pos = pos;
    }

    uint8(is_le?: boolean) {
        this.check(1);
        let v = decode_uint8(this._buffer, this._pos, is_le);
        this._pos += 1;
        return v;
    }
    int8(is_le?: boolean) {
        this.check(1);
        let v = decode_int8(this._buffer, this._pos, is_le);
        this._pos += 1;
        return v;
    }
    uint16(is_le?: boolean) {
        this.check(2);
        let v = decode_uint16(this._buffer, this._pos, is_le);
        this._pos += 2;
        return v;
    }
    int16(is_le?: boolean) {
        this.check(2);
        let v = decode_int16(this._buffer, this._pos, is_le);
        this._pos += 2;
        return v;
    }
    uint32(is_le?: boolean) {
        this.check(4);
        let v = decode_uint32(this._buffer, this._pos, is_le);
        this._pos += 4;
        return v;
    }
    int32(is_le?: boolean) {
        this.check(4);
        let v = decode_int32(this._buffer, this._pos, is_le);
        this._pos += 4;
        return v;
    }
    safe_uint64(is_le?: boolean) {
        return this.uint(8, is_le);
    }
    bigint(is_le?: boolean) {
        this.check(8);
        let v = decode_bigint(this._buffer, this._pos, 8, is_le);
        this._pos += 8;
        return v;
    }
    uint(n: number, is_le?: boolean) {
        this.check(n);
        let v = decode_uint(this._buffer, this._pos, n, is_le);
        this._pos += n;
        return v;
    }

    float(is_le?: boolean) {
        this.check(4);
        let v = decode_float(this._buffer, this._pos, is_le);
        this._pos += 4;
        return v; 
    }

    double(is_le?: boolean) {
        this.check(8);
        let v = decode_double(this._buffer, this._pos, is_le);
        this._pos += 8;
        return v; 
    }

    cstring() {
        let pos = this._buffer.indexOf(0, this._pos);
        if (pos == -1) {
            return "";
        }
        let v = String.fromCharCode.apply(null, Array.from(this._buffer.subarray(this._pos, pos)));
        this._pos = pos + 1;
        return v;
    }

    utf8_str(n: number, le?: boolean) {
        let len = n ? this.uint(n, le) : 0;
        let v = utf8.read(this._buffer, this._pos, this._pos+len);
        this._pos += len;
        return v;
    }

    utf8_cstr() {
        let pos = this._buffer.indexOf(0, this._pos);
        if (pos == -1) {
            return "";
        }
        let v = utf8.read(this._buffer, this._pos, pos);
        this._pos = pos + 1;
        return v;
    }

    raw_buffer(len: number) {
        this.check(len);
        let v = this._buffer.slice(this._pos, this._pos+len);
        this._pos += len;
        return v;        
    }

    size() {
        return this._sz - this._pos;
    }
    check(n: number) {
        if (this._pos + n > this._sz) {
            throw new Error(`invalid decode sz:${this._sz} pos:${this._pos} n:${n}`);
        }
    }
}

function uncomplement(val: number, bitwidth: number) {
    let isnegative = val & (1 << (bitwidth - 1));
    let boundary = (1 << bitwidth);
    let minval = -boundary;
    let mask = boundary - 1;
    return isnegative ? minval + (val & mask) : val;
}

function uncomplement_bigint(val: bigint, bitwidth: bigint) {
    let isnegative = val & (1n << (bitwidth - 1n));
    let boundary = (1n << BigInt(bitwidth));
    let minval = -boundary;
    let mask = boundary - 1n;
    return isnegative ? minval + (val & mask) : val;
}

function readIEEE754(
    buffer: Uint8Array,
    offset: number,
    isLittleEndian: boolean,
    mLen: number,
    nBytes: number
): number {
    let e: number;
    let m: number;
    const eLen = nBytes * 8 - mLen - 1;
    const eMax = (1 << eLen) - 1;
    const eBias = eMax >> 1;
    let nBits = -7;
    let i = !isLittleEndian ? 0 : nBytes - 1;
    const d = !isLittleEndian ? 1 : -1;
    let s = buffer[offset + i];

    i += d;

    e = s & ((1 << -nBits) - 1);
    s >>= -nBits;
    nBits += eLen;
    for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8);

    m = e & ((1 << -nBits) - 1);
    e >>= -nBits;
    nBits += mLen;
    for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8);

    if (e === 0) {
        e = 1 - eBias;
    } else if (e === eMax) {
        return m ? NaN : (s ? -1 : 1) * Infinity;
    } else {
        m = m + Math.pow(2, mLen);
        e = e - eBias;
    }
    return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
}

function writeIEEE754(
    buffer: Uint8Array,
    value: number,
    offset: number,
    isLittleEndian: boolean,
    mLen: number,
    nBytes: number
) {
    let e: number;
    let m: number;
    let c: number;
    let eLen = nBytes * 8 - mLen - 1;
    const eMax = (1 << eLen) - 1;
    const eBias = eMax >> 1;
    const rt = mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0;
    let i = !isLittleEndian ? nBytes - 1 : 0;
    const d = !isLittleEndian ? -1 : 1;
    const s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

    value = Math.abs(value);

    if (isNaN(value) || value === Infinity) {
        m = isNaN(value) ? 1 : 0;
        e = eMax;
    } else {
        e = Math.floor(Math.log(value) / Math.LN2);
        if (value * (c = Math.pow(2, -e)) < 1) {
            e--;
            c *= 2;
        }
        if (e + eBias >= 1) {
            value += rt / c;
        } else {
            value += rt * Math.pow(2, 1 - eBias);
        }
        if (value * c >= 2) {
            e++;
            c /= 2;
        }

        if (e + eBias >= eMax) {
            m = 0;
            e = eMax;
        } else if (e + eBias >= 1) {
            m = (value * c - 1) * Math.pow(2, mLen);
            e = e + eBias;
        } else {
            m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
            e = 0;
        }
    }

    if (isNaN(value)) m = 0;

    while (mLen >= 8) {
        buffer[offset + i] = m & 0xff;
        i += d;
        m /= 256;
        mLen -= 8;
    }

    e = (e << mLen) | m;

    if (isNaN(value)) e += 8;

    eLen += mLen;

    while (eLen > 0) {
        buffer[offset + i] = e & 0xff;
        i += d;
        e /= 256;
        eLen -= 8;
    }

    buffer[offset + i - d] |= s * 128;
}
