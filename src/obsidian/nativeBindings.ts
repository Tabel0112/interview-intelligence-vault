import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface NativeRuntimeInfo {
  platform: NodeJS.Platform;
  arch: string;
  modules: string | undefined;
  electron: string | undefined;
}

export interface NativeBindingResolution {
  ok: boolean;
  target: string;
  bindingPath: string | null;
  packagedTargets: string[];
  error: string | null;
}

export const nativeBindingTarget = (runtime: NativeRuntimeInfo): string =>
  `${runtime.platform}-${runtime.arch}-abi${runtime.modules ?? "unknown"}`;

export function currentNativeRuntime(): NativeRuntimeInfo {
  return {
    platform: process.platform,
    arch: process.arch,
    modules: process.versions.modules,
    electron: process.versions.electron,
  };
}

export function listPackagedNativeTargets(pluginDirectory: string): string[] {
  const nativeDirectory = join(pluginDirectory, "native");
  try {
    return readdirSync(nativeDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(nativeDirectory, entry.name, "better_sqlite3.node")))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function resolveNativeBinding(pluginDirectory: string, runtime = currentNativeRuntime()): NativeBindingResolution {
  const target = nativeBindingTarget(runtime);
  const packagedTargets = listPackagedNativeTargets(pluginDirectory);
  const bindingPath = join(pluginDirectory, "native", target, "better_sqlite3.node");
  if (existsSync(bindingPath)) return { ok: true, target, bindingPath, packagedTargets, error: null };
  const electron = runtime.electron ? ` Electron ${runtime.electron}` : "";
  return {
    ok: false,
    target,
    bindingPath: null,
    packagedTargets,
    error: `SQLite native binding unavailable for ${target}.${electron} Packaged targets: ${packagedTargets.join(", ") || "none"}.`,
  };
}

export function nativeBindingLoadError(resolution: NativeBindingResolution, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`SQLite native binding ${resolution.target} is unavailable or incompatible: ${detail}`);
}
