
export type HEADER_VALUE = number | string | string[];
export type HEADER_MAP = Map<string, HEADER_VALUE>;

export type READ_FUNC = (sz?: number, buffer?: Uint8Array, offset?: number) => Promise<[Uint8Array, number]>;
export type SOCKET_INTERFACE = {
    init?: () => void,
    close?: () => void,
    read: READ_FUNC,
    readall: (buffer?: Uint8Array, offset?: number) => Promise<[Uint8Array, number]>,
    write: (content: string|Uint8Array|Uint8Array[]) => void,
    websocket?: boolean,
}

export type REQUEST_OPTIONS = {
    method: string,
    host: string,
    url: string,
    header?: HEADER_MAP,
    content?: string,
    timeout?: number,
}

export enum INTERFACE_TYPE {
    CLIENT = "client",
    SERVER = "server",
}