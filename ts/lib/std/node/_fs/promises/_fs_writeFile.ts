// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import type { WriteFileOptions } from "../_fs_common";
import type { Encodings } from "../../_utils";

import { writeFile as writeFileCallback } from "../_fs_writeFile";

export function writeFile(
  pathOrRid: string | number | URL,
  data: string | Uint8Array,
  options?: Encodings | WriteFileOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    writeFileCallback(pathOrRid, data, options, (err?: Error | null) => {
      if (err) return reject(err);
      resolve();
    });
  });
}
