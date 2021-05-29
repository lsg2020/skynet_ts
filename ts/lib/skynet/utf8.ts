"use strict";

/**
 * A minimal UTF8 implementation for number arrays.
 * @memberof util
 * @namespace
 */
export const utf8 = {
    /**
     * Calculates the UTF8 byte length of a string.
     * @param {string} string String
     * @returns {number} Byte length
     */
    length: function utf8_length(string: string) {
        var len = 0,
            c = 0;
        for (var i = 0; i < string.length; ++i) {
            c = string.charCodeAt(i);
            if (c < 128)
                len += 1;
            else if (c < 2048)
                len += 2;
            else if ((c & 0xFC00) === 0xD800 && (string.charCodeAt(i + 1) & 0xFC00) === 0xDC00) {
                ++i;
                len += 4;
            } else
                len += 3;
        }
        return len;
    },

    /**
     * Reads UTF8 bytes as a string.
     * @param {Uint8Array} buffer Source buffer
     * @param {number} start Source start
     * @param {number} end Source end
     * @returns {string} String read
     */
    read: function utf8_read(buffer: Uint8Array, start: number, end: number) {
        var len = end - start;
        if (len < 1)
            return "";
        var parts: string[] | null = null,
            chunk = [],
            i = 0, // char offset
            t;     // temporary
        while (start < end) {
            t = buffer[start++];
            if (t < 128)
                chunk[i++] = t;
            else if (t > 191 && t < 224)
                chunk[i++] = (t & 31) << 6 | buffer[start++] & 63;
            else if (t > 239 && t < 365) {
                t = ((t & 7) << 18 | (buffer[start++] & 63) << 12 | (buffer[start++] & 63) << 6 | buffer[start++] & 63) - 0x10000;
                chunk[i++] = 0xD800 + (t >> 10);
                chunk[i++] = 0xDC00 + (t & 1023);
            } else
                chunk[i++] = (t & 15) << 12 | (buffer[start++] & 63) << 6 | buffer[start++] & 63;
            if (i > 8191) {
                (parts || (parts = [])).push(String.fromCharCode.apply(String, chunk));
                i = 0;
            }
        }
        if (parts) {
            if (i)
                parts.push(String.fromCharCode.apply(String, chunk.slice(0, i)));
            return parts.join("");
        }
        return String.fromCharCode.apply(String, chunk.slice(0, i));
    },

    /**
     * Writes a string as UTF8 bytes.
     * @param {string} string Source string
     * @param {Uint8Array} buffer Destination buffer
     * @param {number} offset Destination offset
     * @returns {number} Bytes written
     */
    write: function utf8_write(string: string, buffer: Uint8Array, offset: number, i = 0) {
        var start = offset,
            c1, // character 1
            c2; // character 2
        for (; i < string.length; ++i) {
            c1 = string.charCodeAt(i);
            if (c1 < 128) {
                if (buffer.length < (offset + 1)) {
                    break;
                }

                buffer[offset++] = c1;
            } else if (c1 < 2048) {
                if (buffer.length < (offset + 2)) {
                    break;
                }

                buffer[offset++] = c1 >> 6       | 192;
                buffer[offset++] = c1       & 63 | 128;
            } else if ((c1 & 0xFC00) === 0xD800 && ((c2 = string.charCodeAt(i + 1)) & 0xFC00) === 0xDC00) {
                if (buffer.length < (offset + 4)) {
                    break;
                }

                c1 = 0x10000 + ((c1 & 0x03FF) << 10) + (c2 & 0x03FF);
                ++i;
                buffer[offset++] = c1 >> 18      | 240;
                buffer[offset++] = c1 >> 12 & 63 | 128;
                buffer[offset++] = c1 >> 6  & 63 | 128;
                buffer[offset++] = c1       & 63 | 128;
            } else {
                if (buffer.length < (offset + 3)) {
                    break;
                }

                buffer[offset++] = c1 >> 12      | 224;
                buffer[offset++] = c1 >> 6  & 63 | 128;
                buffer[offset++] = c1       & 63 | 128;
            }
        }
        return [offset - start, i]
    },

};
