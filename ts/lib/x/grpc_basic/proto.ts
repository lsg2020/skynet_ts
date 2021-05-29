

import type {
  Root,
  Type,
  Field,
  Service,
  Message,
  Method,
  ReflectionObject
} from "protobufjs/index";

import * as protobuf from "protobufjs/protobuf";

const lib = protobuf.default.exports as any;

export { Root, Type, Field, Service, Message, Method, ReflectionObject };

export function parse(proto: string): { package: string; root: Root } {
  return lib.parse(proto);
}
