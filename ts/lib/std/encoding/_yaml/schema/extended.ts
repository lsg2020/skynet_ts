// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.

import { Schema } from "../schema";
import { func, regexp, undefinedType } from "../type/mod";
import { def } from "./default";

// Extends JS-YAML default schema with additional JavaScript types
// It is not described in the YAML specification.
export const extended = new Schema({
  explicit: [func, regexp, undefinedType],
  include: [def],
});
