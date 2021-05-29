

import type {
  Root,
  Type,
  Field,
  Service,
  Message,
  Method,
  ReflectionObject
} from "./vendor/protobuf";

import * as protobuf from "./vendor/protobuf@v6.10.2.js";

const lib = protobuf.default.exports as any;

export { Root, Type, Field, Service, Message, Method, ReflectionObject };

export function parse(proto: string): { package: string; root: Root } {
  return lib.parse(proto);
}
