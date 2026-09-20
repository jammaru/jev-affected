import { readdir, rm, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { ConfigError } from "./config.js";
import { git } from "./git.js";

export interface CacheInfo {
  path: string;
  entries: number;
  bytes: number;
}

export async function cacheDirectory(cwd = process.cwd()) {
  const common = resolve(
    cwd,
    (await git(cwd, "rev-parse", "--git-common-dir")).trim(),
  );
  const directory = resolve(
    cwd,
    (await git(cwd, "rev-parse", "--git-path", "jev-affected/cache")).trim(),
  );
  const fromCommon = relative(common, directory);
  if (!fromCommon || fromCommon.startsWith("..") || isAbsolute(fromCommon))
    throw new ConfigError("Cannot resolve a safe Git cache directory.");
  return directory;
}

export async function inspectCache(cwd = process.cwd()): Promise<CacheInfo> {
  const path = await cacheDirectory(cwd);
  let names: string[];
  try {
    names = (await readdir(path)).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { path, entries: 0, bytes: 0 };
    throw error;
  }
  const sizes = await Promise.all(
    names.map(async (name) => (await stat(resolve(path, name))).size),
  );
  return {
    path,
    entries: names.length,
    bytes: sizes.reduce((total, size) => total + size, 0),
  };
}

export async function clearCache(cwd = process.cwd()) {
  const info = await inspectCache(cwd);
  await rm(info.path, { recursive: true, force: true });
  return info;
}
