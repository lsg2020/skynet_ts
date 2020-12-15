
 import {sha1} from "crypt/sha1";
 export {sha1};

export function random(min: number, max: number): number {
    if (max < min) {
        let tmp = min;
        min = max; 
        max = tmp;
    }

    return min + Math.floor((max-min+1) * Math.random());
}

export function randomkey() {
    let key = new Uint8Array(8);
    let x = 0;
    for (let i=0; i<8; i++) {
        key[i] = random(0, 0xff);
        x ^= key[i];
    }
    if (x == 0) {
        key[0] |= 1; // avoid 0
    }

    return key;
}



const base64abc = [
	"A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
	"N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
	"a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
	"n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
	"0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "/"
];
const base64codes = [
	255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
	255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
	255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 62, 255, 255, 255, 63,
	52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 255, 255, 255, 0, 255, 255,
	255, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
	15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 255, 255, 255, 255, 255,
	255, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
	41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51
];

function get_base64_code(char_code: number) {
	if (char_code >= base64codes.length) {
		throw new Error("Unable to parse base64 string.");
	}
	const code = base64codes[char_code];
	if (code === 255) {
		throw new Error("Unable to parse base64 string.");
	}
	return code;
}

export function base64encode(bytes: Uint8Array) {
	let result = '', i, l = bytes.length;
	for (i = 2; i < l; i += 3) {
		result += base64abc[bytes[i - 2] >> 2];
		result += base64abc[((bytes[i - 2] & 0x03) << 4) | (bytes[i - 1] >> 4)];
		result += base64abc[((bytes[i - 1] & 0x0F) << 2) | (bytes[i] >> 6)];
		result += base64abc[bytes[i] & 0x3F];
	}
	if (i === l + 1) { // 1 octet yet to write
		result += base64abc[bytes[i - 2] >> 2];
		result += base64abc[(bytes[i - 2] & 0x03) << 4];
		result += "==";
	}
	if (i === l) { // 2 octets yet to write
		result += base64abc[bytes[i - 2] >> 2];
		result += base64abc[((bytes[i - 2] & 0x03) << 4) | (bytes[i - 1] >> 4)];
		result += base64abc[(bytes[i - 1] & 0x0F) << 2];
		result += "=";
	}
	return result;
}

export function base64decode(str: string) {
	if (str.length % 4 !== 0) {
		throw new Error("Unable to parse base64 string.");
	}
	const index = str.indexOf("=");
	if (index !== -1 && index < str.length - 2) {
		throw new Error("Unable to parse base64 string.");
	}
	let missing_octets = str.endsWith("==") ? 2 : str.endsWith("=") ? 1 : 0,
		n = str.length,
		result = new Uint8Array(3 * (n / 4)),
		buffer: number;
	for (let i = 0, j = 0; i < n; i += 4, j += 3) {
		buffer =
        get_base64_code(str.charCodeAt(i)) << 18 |
        get_base64_code(str.charCodeAt(i + 1)) << 12 |
        get_base64_code(str.charCodeAt(i + 2)) << 6 |
        get_base64_code(str.charCodeAt(i + 3));
		result[j] = buffer >> 16;
		result[j + 1] = (buffer >> 8) & 0xFF;
		result[j + 2] = buffer & 0xFF;
	}
	return result.subarray(0, result.length - missing_octets);
}

export function xor(buffer: Uint8Array, start: number, end: number, key: Uint8Array, key_length?: number) {
	key_length = key_length || key.length;
	if (!key_length) {
		return;
	}
	for (let i=0; i<end-start; i++) {
		buffer[i+start] ^= key[i % key_length];
	}
}

