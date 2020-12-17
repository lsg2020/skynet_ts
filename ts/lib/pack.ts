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
export function decode_str(chunk: Uint8Array, offset: number, n: number): [string, number] {
    let len = decode_uint_be(chunk, offset, n);
    let str = utf8.read(chunk, offset + n, offset + n + len);
    return [str, offset + n + len];
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