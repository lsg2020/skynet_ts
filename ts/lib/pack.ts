import { utf8 } from "utf8";

export function decode_uint8_be(chunk: Uint8Array, offset: number) {
    return chunk[offset];
}
export function decode_uint16_be(chunk: Uint8Array, offset: number) {
    return (chunk[offset] << 8) | (chunk[offset + 1]);
}
export function decode_uint32_be(chunk: Uint8Array, offset: number) {
    return decode_uint_be(chunk, offset, 4);
}
export function decode_uint_be(chunk: Uint8Array, offset: number, n: number): number {
    let r = 0;
    while (n-- > 0) {
        r = (r * 256) + chunk[offset++];
    }
    return Math.floor(r);
}

export function decode_uint8_le(chunk: Uint8Array, offset: number) {
    return chunk[offset];
}
export function decode_uint16_le(chunk: Uint8Array, offset: number) {
    return (chunk[offset]) | (chunk[offset + 1] << 8);
}
export function decode_uint32_le(chunk: Uint8Array, offset: number) {
    return decode_uint_le(chunk, offset, 4);
}
export function decode_uint_le(chunk: Uint8Array, offset: number, n: number): number {
    let r = 0;
    while (n-- > 0) {
        r = (r * 256) + chunk[offset+n];
    }
    return Math.floor(r);
}

export function decode_str(chunk: Uint8Array, offset: number, n: number): [string, number] {
    let len = decode_uint_be(chunk, offset, n);
    let str = utf8.read(chunk, offset + n, offset + n + len);
    return [str, offset + n + len];
}

export function sub_str(buffer: Uint8Array, start?: number, end?: number) {
    return String.fromCharCode.apply(null, Array.from(buffer.slice(start, end)))
}

export function encode_uint8_be(chunk: Uint8Array, offset: number, value: number) {
    chunk[offset] = value;
}
export function encode_uint16_be(chunk: Uint8Array, offset: number, value: number) {
    chunk[offset] = (value >> 8) & 0xff;
    chunk[offset+1] = value & 0xff;
}
export function encode_uint32_be(chunk: Uint8Array, offset: number, value: number) {
    encode_uint_be(chunk, offset, value, 4);
}
export function encode_uint64_be(chunk: Uint8Array, offset: number, value: number) {
    encode_uint_be(chunk, offset, value, 8);
}
export function encode_uint_be(chunk: Uint8Array, offset: number, value: number, n: number) {
    while (n-- > 0) {
        chunk[offset+n] = value % 256;
        value = Math.floor(value / 256);
    }
}

export function encode_uint8_le(chunk: Uint8Array, offset: number, value: number) {
    chunk[offset] = value;
}
export function encode_uint16_le(chunk: Uint8Array, offset: number, value: number) {
    chunk[offset+1] = (value >> 8) & 0xff;
    chunk[offset] = value & 0xff;
}
export function encode_uint32_le(chunk: Uint8Array, offset: number, value: number) {
    encode_uint_le(chunk, offset, value, 4);
}
export function encode_uint64_le(chunk: Uint8Array, offset: number, value: number) {
    encode_uint_le(chunk, offset, value, 8);
}
export function encode_uint_le(chunk: Uint8Array, offset: number, value: number, n: number) {
    while (n-- > 0) {
        chunk[offset++] = value % 256;
        value = Math.floor(value / 256);
    }
}

export function encode_cstring(chunk: Uint8Array, offset: number, value: string) {
    let [sz] = utf8.write(value, chunk, offset);
    chunk[offset + sz] = 0;
    return offset + sz + 1;
}

export function encode_buf(chunk: Uint8Array, offset: number, value: Uint8Array, n: number, le?: boolean) {
    if (n) {
        if (le) {
            encode_uint_le(chunk, offset, value.length, n);
        } else {
            encode_uint_be(chunk, offset, value.length, n);
        }
    }
    chunk.set(value, offset+n);
    return offset + value.length + n;
}

export class encoder {
    static init_buffer_sz = 128;
    static shared_buffer = new Uint8Array(128);

    private _buffer: Uint8Array;
    private _view?: DataView;
    private _pos = 0;
    constructor(buffer?: Uint8Array, use_shared: boolean = true) {
        if (buffer) {
            this._buffer = buffer;
        } else if (use_shared) {
            this._buffer = encoder.shared_buffer;
        } else {
            this._buffer = new Uint8Array(encoder.init_buffer_sz);
        }
    }

    private _ensure_write_sz(sz: number) {
        if (this._buffer.length < this._pos + sz) {
            let new_buffer = new Uint8Array((this._pos+sz)*2);
            new_buffer.set(this._buffer);
            if (this._buffer == encoder.shared_buffer) {
                encoder.shared_buffer = new_buffer;
            }
            this._buffer = new_buffer;
        }
    }
        
    uint8_be(value: number) {
        this._ensure_write_sz(1);
        encode_uint8_be(this._buffer, this._pos, value);
        this._pos += 1;
    }
    uint16_be(value: number) {
        this._ensure_write_sz(2);
        encode_uint16_be(this._buffer, this._pos, value);
        this._pos += 2;
    }
    uint32_be(value: number) {
        this._ensure_write_sz(4);
        encode_uint32_be(this._buffer, this._pos, value);
        this._pos += 4;
    }
    uint64_be(value: number) {
        this._ensure_write_sz(8);
        encode_uint64_be(this._buffer, this._pos, value);
        this._pos += 8;
    }
    uint_be(value: number, n: number) {
        this._ensure_write_sz(n);
        encode_uint_be(this._buffer, this._pos, value, n);
        this._pos += n;
    }

    float_be(value: number) {
        this._ensure_write_sz(4);
        this._view = this._view || new DataView(this._buffer.buffer);
        this._view.setFloat32(this._pos, value, false);
        this._pos += 4;
    }

    double_be(value: number) {
        this._ensure_write_sz(8);
        this._view = this._view || new DataView(this._buffer.buffer);
        this._view.setFloat64(this._pos, value, false);
        this._pos += 8;
    }

    uint8_le(value: number) {
        this._ensure_write_sz(1);
        encode_uint8_le(this._buffer, this._pos, value);
        this._pos += 1;
    }
    uint16_le(value: number) {
        this._ensure_write_sz(2);
        encode_uint16_le(this._buffer, this._pos, value);
        this._pos += 2;
    }
    uint32_le(value: number) {
        this._ensure_write_sz(4);
        encode_uint32_le(this._buffer, this._pos, value);
        this._pos += 4;
    }
    uint64_le(value: number) {
        this._ensure_write_sz(8);
        encode_uint64_le(this._buffer, this._pos, value);
        this._pos += 8;
    }
    uint_le(value: number, n: number) {
        this._ensure_write_sz(n);
        encode_uint_le(this._buffer, this._pos, value, n);
        this._pos += n;
    }

    float_le(value: number) {
        this._ensure_write_sz(4);
        this._view = this._view || new DataView(this._buffer.buffer);
        this._view.setFloat32(this._pos, value, true);
        this._pos += 4;
    }

    double_le(value: number) {
        this._ensure_write_sz(8);
        this._view = this._view || new DataView(this._buffer.buffer);
        this._view.setFloat64(this._pos, value, true);
        this._pos += 8;
    }

    cstring(value: string) {
        this._ensure_write_sz(utf8.length(value)+1);
        this._pos = encode_cstring(this._buffer, this._pos, value);
    }

    buffer(value: Uint8Array, n: number, le?: boolean) {
        this._ensure_write_sz(value.length+n);
        this._pos = encode_buf(this._buffer, this._pos, value, n, le);
    }

    utf8_str(value: string, n: number, le?: boolean) {
        let len = utf8.length(value);
        this._ensure_write_sz(len+n);
        if (n) {
            if (le) {
                this.uint_le(len, n);
            } else {
                this.uint_be(len, n);
            }
        }
        utf8.write(value, this._buffer, this._pos);
        this._pos += len;
    }

    padding(n: number) {
        this._ensure_write_sz(n);
        this._pos += n;
    }

    finish(): Uint8Array {
        return this._buffer.subarray(0, this._pos);
    }
};
