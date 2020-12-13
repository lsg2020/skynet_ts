
export type HEADER_VALUE = number | string | string[];
export type HEADER_MAP = Map<string, HEADER_VALUE>;

export type READ_FUNC = (sz?: number, buffer?: Uint8Array, offset?: number) => Promise<[Uint8Array, number]>;
export type SOCKET_INTERFACE = {
    init?: () => void,
    close?: () => void,
    read: READ_FUNC,
    readall: (buffer?: Uint8Array, offset?: number) => Promise<[Uint8Array, number]>,
    write: (content: string|Uint8Array[]) => void,
}

