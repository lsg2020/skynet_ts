// Ported from js-yaml v3.13.1:
// https://github.com/nodeca/js-yaml/commit/665aadda42349dcae869f12040d9b10ef18d12da
// Copyright 2011-2015 by Vitaly Puzrin. All rights reserved. MIT license.
// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.

export type { ParseOptions } from "./_yaml/parse";
export { parse, parseAll } from "./_yaml/parse";
export type { DumpOptions as StringifyOptions } from "./_yaml/stringify";
export { stringify } from "./_yaml/stringify";
export type { SchemaDefinition } from "./_yaml/schema";
export type { StyleVariant, Type } from "./_yaml/type";
export {
  CORE_SCHEMA,
  DEFAULT_SCHEMA,
  EXTENDED_SCHEMA,
  FAILSAFE_SCHEMA,
  JSON_SCHEMA,
} from "./_yaml/schema/mod";
