// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import { Encodings, notImplemented } from "../_utils";
import { fromFileUrl } from "../path";
import { Buffer } from "../buffer";
import { writeAll, writeAllSync } from "../../io/util";
import {
  CallbackWithError,
  checkEncoding,
  getEncoding,
  getOpenOptions,
  isFileOptions,
  WriteFileOptions,
} from "./_fs_common";

export function writeFile(
  pathOrRid: string | number | URL,
  data: string | Uint8Array,
  optOrCallback: Encodings | CallbackWithError | WriteFileOptions | undefined,
  callback?: CallbackWithError,
): void {
  const callbackFn: CallbackWithError | undefined =
    optOrCallback instanceof Function ? optOrCallback : callback;
  const options: Encodings | WriteFileOptions | undefined =
    optOrCallback instanceof Function ? undefined : optOrCallback;

  if (!callbackFn) {
    throw new TypeError("Callback must be a function.");
  }

  pathOrRid = pathOrRid instanceof URL ? fromFileUrl(pathOrRid) : pathOrRid;

  const flag: string | undefined = isFileOptions(options)
    ? options.flag
    : undefined;

  const mode: number | undefined = isFileOptions(options)
    ? options.mode
    : undefined;

  const encoding = checkEncoding(getEncoding(options)) || "utf8";
  const openOptions = getOpenOptions(flag || "w");

  if (typeof data === "string") data = Buffer.from(data, encoding);

  const isRid = typeof pathOrRid === "number";
  let file;

  let error: Error | null = null;
  (async () => {
    try {
      file = isRid
        ? new Deno.File(pathOrRid as number)
        : await Deno.open(pathOrRid as string, openOptions);

      if (!isRid && mode) {
        if (Deno.build.os === "windows") notImplemented(`"mode" on Windows`);
        await Deno.chmod(pathOrRid as string, mode);
      }

      await writeAll(file, data as Uint8Array);
    } catch (e) {
      error = e;
    } finally {
      // Make sure to close resource
      if (!isRid && file) file.close();
      callbackFn(error);
    }
  })();
}

export function writeFileSync(
  pathOrRid: string | number | URL,
  data: string | Uint8Array,
  options?: Encodings | WriteFileOptions,
): void {
  pathOrRid = pathOrRid instanceof URL ? fromFileUrl(pathOrRid) : pathOrRid;

  const flag: string | undefined = isFileOptions(options)
    ? options.flag
    : undefined;

  const mode: number | undefined = isFileOptions(options)
    ? options.mode
    : undefined;

  const encoding = checkEncoding(getEncoding(options)) || "utf8";
  const openOptions = getOpenOptions(flag || "w");

  if (typeof data === "string") data = Buffer.from(data, encoding);

  const isRid = typeof pathOrRid === "number";
  let file;

  let error: Error | null = null;
  try {
    file = isRid
      ? new Deno.File(pathOrRid as number)
      : Deno.openSync(pathOrRid as string, openOptions);

    if (!isRid && mode) {
      if (Deno.build.os === "windows") notImplemented(`"mode" on Windows`);
      Deno.chmodSync(pathOrRid as string, mode);
    }

    writeAllSync(file, data as Uint8Array);
  } catch (e) {
    error = e;
  } finally {
    // Make sure to close resource
    if (!isRid && file) file.close();
  }

  if (error) throw error;
}
