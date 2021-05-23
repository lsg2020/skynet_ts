// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import { access, accessSync } from "./_fs/_fs_access";
import { appendFile, appendFileSync } from "./_fs/_fs_appendFile";
import { chmod, chmodSync } from "./_fs/_fs_chmod";
import { chown, chownSync } from "./_fs/_fs_chown";
import { close, closeSync } from "./_fs/_fs_close";
import * as constants from "./_fs/_fs_constants";
import { copyFile, copyFileSync } from "./_fs/_fs_copy";
import Dir from "./_fs/_fs_dir";
import Dirent from "./_fs/_fs_dirent";
import { exists, existsSync } from "./_fs/_fs_exists";
import { fdatasync, fdatasyncSync } from "./_fs/_fs_fdatasync";
import { fstat, fstatSync } from "./_fs/_fs_fstat";
import { fsync, fsyncSync } from "./_fs/_fs_fsync";
import { ftruncate, ftruncateSync } from "./_fs/_fs_ftruncate";
import { futimes, futimesSync } from "./_fs/_fs_futimes";
import { link, linkSync } from "./_fs/_fs_link";
import { lstat, lstatSync } from "./_fs/_fs_lstat";
import { mkdir, mkdirSync } from "./_fs/_fs_mkdir";
import { mkdtemp, mkdtempSync } from "./_fs/_fs_mkdtemp";
import { open, openSync } from "./_fs/_fs_open";
import { readdir, readdirSync } from "./_fs/_fs_readdir";
import { readFile, readFileSync } from "./_fs/_fs_readFile";
import { readlink, readlinkSync } from "./_fs/_fs_readlink";
import { realpath, realpathSync } from "./_fs/_fs_realpath";
import { rename, renameSync } from "./_fs/_fs_rename";
import { rmdir, rmdirSync } from "./_fs/_fs_rmdir";
import { stat, statSync } from "./_fs/_fs_stat";
import { symlink, symlinkSync } from "./_fs/_fs_symlink";
import { truncate, truncateSync } from "./_fs/_fs_truncate";
import { unlink, unlinkSync } from "./_fs/_fs_unlink";
import { utimes, utimesSync } from "./_fs/_fs_utimes";
import { watch } from "./_fs/_fs_watch";
import { writeFile, writeFileSync } from "./_fs/_fs_writeFile";

import * as promises from "./_fs/promises/mod";

export default {
  access,
  accessSync,
  appendFile,
  appendFileSync,
  chmod,
  chmodSync,
  chown,
  chownSync,
  close,
  closeSync,
  constants,
  copyFile,
  copyFileSync,
  Dir,
  Dirent,
  exists,
  existsSync,
  fdatasync,
  fdatasyncSync,
  fstat,
  fstatSync,
  fsync,
  fsyncSync,
  ftruncate,
  ftruncateSync,
  futimes,
  futimesSync,
  link,
  linkSync,
  lstat,
  lstatSync,
  mkdir,
  mkdirSync,
  mkdtemp,
  mkdtempSync,
  open,
  openSync,
  promises,
  readdir,
  readdirSync,
  readFile,
  readFileSync,
  readlink,
  readlinkSync,
  realpath,
  realpathSync,
  rename,
  renameSync,
  rmdir,
  rmdirSync,
  stat,
  statSync,
  symlink,
  symlinkSync,
  truncate,
  truncateSync,
  unlink,
  unlinkSync,
  utimes,
  utimesSync,
  watch,
  writeFile,
  writeFileSync,
};

export {
  access,
  accessSync,
  appendFile,
  appendFileSync,
  chmod,
  chmodSync,
  chown,
  chownSync,
  close,
  closeSync,
  constants,
  copyFile,
  copyFileSync,
  Dir,
  Dirent,
  exists,
  existsSync,
  fdatasync,
  fdatasyncSync,
  fstat,
  fstatSync,
  fsync,
  fsyncSync,
  ftruncate,
  ftruncateSync,
  futimes,
  futimesSync,
  link,
  linkSync,
  lstat,
  lstatSync,
  mkdir,
  mkdirSync,
  mkdtemp,
  mkdtempSync,
  open,
  openSync,
  promises,
  readdir,
  readdirSync,
  readFile,
  readFileSync,
  readlink,
  readlinkSync,
  realpath,
  realpathSync,
  rename,
  renameSync,
  rmdir,
  rmdirSync,
  stat,
  statSync,
  symlink,
  symlinkSync,
  truncate,
  truncateSync,
  unlink,
  unlinkSync,
  utimes,
  utimesSync,
  watch,
  writeFile,
  writeFileSync,
};
