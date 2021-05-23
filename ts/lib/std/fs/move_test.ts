// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import {
  assertEquals,
  assertThrows,
  assertThrowsAsync,
} from "../testing/asserts";
import * as path from "../path/mod";
import { move, moveSync } from "./move";
import { ensureFile, ensureFileSync } from "./ensure_file";
import { ensureDir, ensureDirSync } from "./ensure_dir";
import { exists, existsSync } from "./exists";

const moduleDir = path.dirname(path.fromFileUrl(import.meta.url));
const testdataDir = path.resolve(moduleDir, "testdata");

Deno.test("moveDirectoryIfSrcNotExists", async function () {
  const srcDir = path.join(testdataDir, "move_test_src_1");
  const destDir = path.join(testdataDir, "move_test_dest_1");
  // if src directory not exist
  await assertThrowsAsync(
    async () => {
      await move(srcDir, destDir);
    },
  );
});

Deno.test("moveDirectoryIfDestNotExists", async function () {
  const srcDir = path.join(testdataDir, "move_test_src_2");
  const destDir = path.join(testdataDir, "move_test_dest_2");

  await Deno.mkdir(srcDir, { recursive: true });

  // if dest directory not exist
  await assertThrowsAsync(
    async () => {
      await move(srcDir, destDir);
      throw new Error("should not throw error");
    },
    Error,
    "should not throw error",
  );

  await Deno.remove(destDir);
});

Deno.test(
  "moveDirectoryIfDestNotExistsAndOverwrite",
  async function () {
    const srcDir = path.join(testdataDir, "move_test_src_2");
    const destDir = path.join(testdataDir, "move_test_dest_2");

    await Deno.mkdir(srcDir, { recursive: true });

    // if dest directory not exist
    await assertThrowsAsync(
      async () => {
        await move(srcDir, destDir, { overwrite: true });
        throw new Error("should not throw error");
      },
      Error,
      "should not throw error",
    );

    await Deno.remove(destDir);
  },
);

Deno.test("moveFileIfSrcNotExists", async function () {
  const srcFile = path.join(testdataDir, "move_test_src_3", "test.txt");
  const destFile = path.join(testdataDir, "move_test_dest_3", "test.txt");

  // if src directory not exist
  await assertThrowsAsync(
    async () => {
      await move(srcFile, destFile);
    },
  );
});

Deno.test("moveFileIfDestExists", async function () {
  const srcDir = path.join(testdataDir, "move_test_src_4");
  const destDir = path.join(testdataDir, "move_test_dest_4");
  const srcFile = path.join(srcDir, "test.txt");
  const destFile = path.join(destDir, "test.txt");
  const srcContent = new TextEncoder().encode("src");
  const destContent = new TextEncoder().encode("dest");

  // make sure files exists
  await Promise.all([ensureFile(srcFile), ensureFile(destFile)]);

  // write file content
  await Promise.all([
    Deno.writeFile(srcFile, srcContent),
    Deno.writeFile(destFile, destContent),
  ]);

  // make sure the test file have been created
  assertEquals(new TextDecoder().decode(await Deno.readFile(srcFile)), "src");
  assertEquals(new TextDecoder().decode(await Deno.readFile(destFile)), "dest");

  // move it without override
  await assertThrowsAsync(
    async () => {
      await move(srcFile, destFile);
    },
    Error,
    "dest already exists",
  );

  // move again with overwrite
  await assertThrowsAsync(
    async () => {
      await move(srcFile, destFile, { overwrite: true });
      throw new Error("should not throw error");
    },
    Error,
    "should not throw error",
  );

  assertEquals(await exists(srcFile), false);
  assertEquals(new TextDecoder().decode(await Deno.readFile(destFile)), "src");

  // clean up
  await Promise.all([
    Deno.remove(srcDir, { recursive: true }),
    Deno.remove(destDir, { recursive: true }),
  ]);
});

Deno.test("moveDirectory", async function () {
  const srcDir = path.join(testdataDir, "move_test_src_5");
  const destDir = path.join(testdataDir, "move_test_dest_5");
  const srcFile = path.join(srcDir, "test.txt");
  const destFile = path.join(destDir, "test.txt");
  const srcContent = new TextEncoder().encode("src");

  await Deno.mkdir(srcDir, { recursive: true });
  assertEquals(await exists(srcDir), true);
  await Deno.writeFile(srcFile, srcContent);

  await move(srcDir, destDir);

  assertEquals(await exists(srcDir), false);
  assertEquals(await exists(destDir), true);
  assertEquals(await exists(destFile), true);

  const destFileContent = new TextDecoder().decode(
    await Deno.readFile(destFile),
  );
  assertEquals(destFileContent, "src");

  await Deno.remove(destDir, { recursive: true });
});

Deno.test(
  "moveIfSrcAndDestDirectoryExistsAndOverwrite",
  async function () {
    const srcDir = path.join(testdataDir, "move_test_src_6");
    const destDir = path.join(testdataDir, "move_test_dest_6");
    const srcFile = path.join(srcDir, "test.txt");
    const destFile = path.join(destDir, "test.txt");
    const srcContent = new TextEncoder().encode("src");
    const destContent = new TextEncoder().encode("dest");

    await Promise.all([
      Deno.mkdir(srcDir, { recursive: true }),
      Deno.mkdir(destDir, { recursive: true }),
    ]);
    assertEquals(await exists(srcDir), true);
    assertEquals(await exists(destDir), true);
    await Promise.all([
      Deno.writeFile(srcFile, srcContent),
      Deno.writeFile(destFile, destContent),
    ]);

    await move(srcDir, destDir, { overwrite: true });

    assertEquals(await exists(srcDir), false);
    assertEquals(await exists(destDir), true);
    assertEquals(await exists(destFile), true);

    const destFileContent = new TextDecoder().decode(
      await Deno.readFile(destFile),
    );
    assertEquals(destFileContent, "src");

    await Deno.remove(destDir, { recursive: true });
  },
);

Deno.test("moveIntoSubDir", async function () {
  const srcDir = path.join(testdataDir, "move_test_src_7");
  const destDir = path.join(srcDir, "nest");

  await ensureDir(destDir);

  await assertThrowsAsync(
    async () => {
      await move(srcDir, destDir);
    },
    Error,
    `Cannot move '${srcDir}' to a subdirectory of itself, '${destDir}'.`,
  );
  await Deno.remove(srcDir, { recursive: true });
});

Deno.test("moveSyncDirectoryIfSrcNotExists", function (): void {
  const srcDir = path.join(testdataDir, "move_sync_test_src_1");
  const destDir = path.join(testdataDir, "move_sync_test_dest_1");
  // if src directory not exist
  assertThrows((): void => {
    moveSync(srcDir, destDir);
  });
});

Deno.test("moveSyncDirectoryIfDestNotExists", function (): void {
  const srcDir = path.join(testdataDir, "move_sync_test_src_2");
  const destDir = path.join(testdataDir, "move_sync_test_dest_2");

  Deno.mkdirSync(srcDir, { recursive: true });

  // if dest directory not exist
  assertThrows(
    (): void => {
      moveSync(srcDir, destDir);
      throw new Error("should not throw error");
    },
    Error,
    "should not throw error",
  );

  Deno.removeSync(destDir);
});

Deno.test("moveSyncDirectoryIfDestNotExistsAndOverwrite", function (): void {
  const srcDir = path.join(testdataDir, "move_sync_test_src_2");
  const destDir = path.join(testdataDir, "move_sync_test_dest_2");

  Deno.mkdirSync(srcDir, { recursive: true });

  // if dest directory not exist width overwrite
  assertThrows(
    (): void => {
      moveSync(srcDir, destDir, { overwrite: true });
      throw new Error("should not throw error");
    },
    Error,
    "should not throw error",
  );

  Deno.removeSync(destDir);
});

Deno.test("moveSyncFileIfSrcNotExists", function (): void {
  const srcFile = path.join(testdataDir, "move_sync_test_src_3", "test.txt");
  const destFile = path.join(testdataDir, "move_sync_test_dest_3", "test.txt");

  // if src directory not exist
  assertThrows((): void => {
    moveSync(srcFile, destFile);
  });
});

Deno.test("moveSyncFileIfDestExists", function (): void {
  const srcDir = path.join(testdataDir, "move_sync_test_src_4");
  const destDir = path.join(testdataDir, "move_sync_test_dest_4");
  const srcFile = path.join(srcDir, "test.txt");
  const destFile = path.join(destDir, "test.txt");
  const srcContent = new TextEncoder().encode("src");
  const destContent = new TextEncoder().encode("dest");

  // make sure files exists
  ensureFileSync(srcFile);
  ensureFileSync(destFile);

  // write file content
  Deno.writeFileSync(srcFile, srcContent);
  Deno.writeFileSync(destFile, destContent);

  // make sure the test file have been created
  assertEquals(new TextDecoder().decode(Deno.readFileSync(srcFile)), "src");
  assertEquals(new TextDecoder().decode(Deno.readFileSync(destFile)), "dest");

  // move it without override
  assertThrows(
    (): void => {
      moveSync(srcFile, destFile);
    },
    Error,
    "dest already exists",
  );

  // move again with overwrite
  assertThrows(
    (): void => {
      moveSync(srcFile, destFile, { overwrite: true });
      throw new Error("should not throw error");
    },
    Error,
    "should not throw error",
  );

  assertEquals(existsSync(srcFile), false);
  assertEquals(new TextDecoder().decode(Deno.readFileSync(destFile)), "src");

  // clean up
  Deno.removeSync(srcDir, { recursive: true });
  Deno.removeSync(destDir, { recursive: true });
});

Deno.test("moveSyncDirectory", function (): void {
  const srcDir = path.join(testdataDir, "move_sync_test_src_5");
  const destDir = path.join(testdataDir, "move_sync_test_dest_5");
  const srcFile = path.join(srcDir, "test.txt");
  const destFile = path.join(destDir, "test.txt");
  const srcContent = new TextEncoder().encode("src");

  Deno.mkdirSync(srcDir, { recursive: true });
  assertEquals(existsSync(srcDir), true);
  Deno.writeFileSync(srcFile, srcContent);

  moveSync(srcDir, destDir);

  assertEquals(existsSync(srcDir), false);
  assertEquals(existsSync(destDir), true);
  assertEquals(existsSync(destFile), true);

  const destFileContent = new TextDecoder().decode(Deno.readFileSync(destFile));
  assertEquals(destFileContent, "src");

  Deno.removeSync(destDir, { recursive: true });
});

Deno.test("moveSyncIfSrcAndDestDirectoryExistsAndOverwrite", function (): void {
  const srcDir = path.join(testdataDir, "move_sync_test_src_6");
  const destDir = path.join(testdataDir, "move_sync_test_dest_6");
  const srcFile = path.join(srcDir, "test.txt");
  const destFile = path.join(destDir, "test.txt");
  const srcContent = new TextEncoder().encode("src");
  const destContent = new TextEncoder().encode("dest");

  Deno.mkdirSync(srcDir, { recursive: true });
  Deno.mkdirSync(destDir, { recursive: true });
  assertEquals(existsSync(srcDir), true);
  assertEquals(existsSync(destDir), true);
  Deno.writeFileSync(srcFile, srcContent);
  Deno.writeFileSync(destFile, destContent);

  moveSync(srcDir, destDir, { overwrite: true });

  assertEquals(existsSync(srcDir), false);
  assertEquals(existsSync(destDir), true);
  assertEquals(existsSync(destFile), true);

  const destFileContent = new TextDecoder().decode(Deno.readFileSync(destFile));
  assertEquals(destFileContent, "src");

  Deno.removeSync(destDir, { recursive: true });
});

Deno.test("moveSyncIntoSubDir", function (): void {
  const srcDir = path.join(testdataDir, "move_sync_test_src_7");
  const destDir = path.join(srcDir, "nest");

  ensureDirSync(destDir);

  assertThrows(
    (): void => {
      moveSync(srcDir, destDir);
    },
    Error,
    `Cannot move '${srcDir}' to a subdirectory of itself, '${destDir}'.`,
  );
  Deno.removeSync(srcDir, { recursive: true });
});
