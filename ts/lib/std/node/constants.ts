// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.

// Based on: https://github.com/nodejs/node/blob/0646eda/lib/constants.js

import { constants as fsConstants } from "./fs";
import { constants as osConstants } from "./os";

export default {
  ...fsConstants,
  ...osConstants.dlopen,
  ...osConstants.errno,
  ...osConstants.signals,
  ...osConstants.priority,
};
