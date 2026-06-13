import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/index.js";
import { PACKAGED_MIGRATION_COUNT } from "../src/db/migrations/index.js";
import { renderRoute } from "../src/frontend/index.js";
import {
  nativeBindingLoadError,
  nativeBindingTarget,
  resolveNativeBinding,
  type NativeRuntimeInfo,
} from "../src/obsidian/nativeBindings.js";
import { createUnavailableFrontendApi, initialPluginHealth } from "../src/obsidian/startup.js";

const supportedRuntime: NativeRuntimeInfo = {
  platform: "darwin",
  arch: "arm64",
  modules: "140",
  electron: "39.8.3",
};

describe("native SQLite binding resolution", () => {
  it("selects an exact platform, architecture, and ABI target relative to the installed plugin", async () => {
    const pluginDirectory = await mkdtemp(join(tmpdir(), "native-binding-plugin-"));
    const bindingDirectory = join(pluginDirectory, "native", nativeBindingTarget(supportedRuntime));
    await mkdir(bindingDirectory, { recursive: true });
    await writeFile(join(bindingDirectory, "better_sqlite3.node"), "test");

    expect(resolveNativeBinding(pluginDirectory, supportedRuntime)).toEqual({
      ok: true,
      target: "darwin-arm64-abi140",
      bindingPath: join(bindingDirectory, "better_sqlite3.node"),
      packagedTargets: ["darwin-arm64-abi140"],
      error: null,
    });
  });

  it("does not fall back across incompatible targets and returns a readable health error", async () => {
    const pluginDirectory = await mkdtemp(join(tmpdir(), "native-binding-mismatch-"));
    const wrongTarget = join(pluginDirectory, "native", "darwin-x64-abi140");
    await mkdir(wrongTarget, { recursive: true });
    await writeFile(join(wrongTarget, "better_sqlite3.node"), "test");

    const resolution = resolveNativeBinding(pluginDirectory, supportedRuntime);
    expect(resolution).toMatchObject({
      ok: false,
      target: "darwin-arm64-abi140",
      bindingPath: null,
      packagedTargets: ["darwin-x64-abi140"],
    });
    expect(resolution.error).toContain("SQLite native binding unavailable for darwin-arm64-abi140");
    expect(resolution.error).toContain("Packaged targets: darwin-x64-abi140");
    expect(nativeBindingLoadError(resolution, new Error("NODE_MODULE_VERSION 139"))).toHaveProperty(
      "message",
      expect.stringContaining("unavailable or incompatible: NODE_MODULE_VERSION 139"),
    );
  });

  it("turns an invalid exact-target binary load into a readable compatibility error", async () => {
    const pluginDirectory = await mkdtemp(join(tmpdir(), "native-binding-invalid-"));
    const bindingDirectory = join(pluginDirectory, "native", nativeBindingTarget(supportedRuntime));
    const bindingPath = join(bindingDirectory, "better_sqlite3.node");
    await mkdir(bindingDirectory, { recursive: true });
    await writeFile(bindingPath, "not a native module");
    const resolution = resolveNativeBinding(pluginDirectory, supportedRuntime);

    let loadError: unknown;
    try {
      openDatabase(":memory:", { nativeBinding: bindingPath });
    } catch (error) {
      loadError = nativeBindingLoadError(resolution, error);
    }
    expect(loadError).toBeInstanceOf(Error);
    expect((loadError as Error).message).toContain("SQLite native binding darwin-arm64-abi140 is unavailable or incompatible");
  });

  it("keeps health views available when no compatible binding is packaged", async () => {
    const pluginDirectory = await mkdtemp(join(tmpdir(), "native-binding-missing-"));
    const resolution = resolveNativeBinding(pluginDirectory, supportedRuntime);
    const health = {
      ...initialPluginHealth(),
      status: "error" as const,
      lastInitializationError: resolution.error,
      nativeBindingTarget: resolution.target,
      packagedNativeTargets: resolution.packagedTargets,
    };

    const html = await renderRoute(createUnavailableFrontendApi(() => health), "mv://dashboard");
    expect(html).toContain("SQLite native binding unavailable");
    expect(html).toContain("darwin-arm64-abi140");
    expect(html).toContain("Packaged native targets");
  });

  it("packages the currently supported target and keeps the normal SQLite runtime working", () => {
    expect(resolveNativeBinding(resolve("."), supportedRuntime)).toMatchObject({
      ok: true,
      target: "darwin-arm64-abi140",
    });
    const db = openDatabase(":memory:");
    expect(db.prepare("SELECT 1 value").get()).toEqual({ value: 1 });
    db.close();
  });
});

describe("portable installed-plugin resources", () => {
  it("runs migrations from an explicit installed plugin directory", async () => {
    const pluginDirectory = await mkdtemp(join(tmpdir(), "installed-plugin-"));
    const migrationDirectory = join(pluginDirectory, "migrations");
    await cp("src/db/migrations", migrationDirectory, { recursive: true });
    const db = openDatabase(join(pluginDirectory, "transcript-memory.sqlite"), { migrationDirectory });

    expect((db.prepare("SELECT COUNT(*) count FROM schema_migrations").get() as { count: number }).count).toBe(PACKAGED_MIGRATION_COUNT);
    db.close();
  });

  it("builds without a developer vault path or implicit node_modules dependency", async () => {
    const outputFiles = [
      "main.js",
      "dist/transcript-memory-vault/main.js",
      "dist/transcript-memory-vault/manifest.json",
    ];
    for (const file of outputFiles) {
      const contents = await readFile(file, "utf8");
      expect(contents).not.toContain(resolve("."));
      expect(contents).not.toMatch(/\/Users\/[^/]+\//);
    }
    expect(existsSync("dist/transcript-memory-vault/native/darwin-arm64-abi140/better_sqlite3.node")).toBe(true);
    expect(existsSync("dist/transcript-memory-vault/migrations/001_initial_schema.sql")).toBe(true);
    expect(existsSync("dist/transcript-memory-vault/node_modules")).toBe(false);
  });
});
