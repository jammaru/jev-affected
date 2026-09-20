import { execFile } from "node:child_process";
import { promisify } from "node:util";
import picomatch from "picomatch";
import { type Config, ConfigError, secretPatterns } from "./config.js";

const exec = promisify(execFile);
export async function git(cwd: string, ...args: string[]) {
  return (
    await exec("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_LITERAL_PATHSPECS: "1" },
    })
  ).stdout;
}
export const matches = (path: string, patterns: string[]) =>
  patterns.length > 0 && picomatch(patterns, { dot: true })(path);
export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: string;
}
export interface ChangeState {
  base: string;
  head: string;
  files: ChangedFile[];
  diff: string;
  incomplete: boolean;
  warnings: string[];
}
export async function collectChanges(
  config: Config,
  options: { cwd?: string; base?: string; head?: string } = {},
): Promise<ChangeState> {
  const cwd = options.cwd ?? process.cwd();
  const resolve = async (ref: string) =>
    (
      await git(
        cwd,
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${ref}^{commit}`,
      )
    ).trim();
  let head: string;
  try {
    head = await resolve(options.head ?? "HEAD");
  } catch {
    throw new ConfigError("Cannot resolve head commit.");
  }
  const explicit = options.base ?? config.base;
  const candidates = explicit
    ? [explicit]
    : [
        process.env.GITHUB_BASE_REF
          ? `origin/${process.env.GITHUB_BASE_REF}`
          : undefined,
        "origin/main",
        "main",
        "master",
      ].filter((x): x is string => !!x);
  let base: string | undefined;
  for (const ref of candidates) {
    try {
      base = (await git(cwd, "merge-base", await resolve(ref), head)).trim();
      break;
    } catch {}
  }
  if (!base)
    throw new ConfigError(
      "Cannot resolve Git base. Fetch the base branch or pass --base.",
    );
  const parts = (
    await git(
      cwd,
      "diff",
      "--name-status",
      "-z",
      "--find-renames",
      base,
      head,
      "--",
    )
  ).split("\0");
  const files: ChangedFile[] = [];
  for (let i = 0; i < parts.length && parts[i]; ) {
    const status = parts[i++];
    const path = parts[i++];
    if (!status || !path) throw new Error("Malformed Git file listing");
    if (status.startsWith("R") || status.startsWith("C")) {
      const target = parts[i++];
      if (!target) throw new Error("Malformed Git rename listing");
      files.push({ status, oldPath: path, path: target });
    } else files.push({ status, path });
  }
  const state: ChangeState = {
    base,
    head,
    files: [],
    diff: "",
    incomplete: false,
    warnings: [],
  };
  for (const file of files) {
    const paths = [file.path, ...(file.oldPath ? [file.oldPath] : [])];
    if (
      paths.some((p) =>
        matches(p, [...secretPatterns, ...config.analysis.exclude]),
      )
    ) {
      state.incomplete = true;
      state.warnings.push("Excluded sensitive file change; running all tasks.");
      continue;
    }
    if (paths.every((p) => matches(p, config.ignore))) continue;
    state.files.push(file);
    try {
      const patch = await git(
        cwd,
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--find-renames",
        "--unified=3",
        base,
        head,
        "--",
        ...paths,
      );
      if (
        patch.includes("Binary files ") ||
        patch.includes("Subproject commit ")
      ) {
        state.incomplete = true;
        state.warnings.push("Binary or submodule change; running all tasks.");
      }
      if (
        Buffer.byteLength(state.diff) + Buffer.byteLength(patch) >
        config.analysis.maxDiffBytes
      ) {
        state.incomplete = true;
        state.warnings.push("Diff exceeds analysis limit; running all tasks.");
      } else state.diff += patch;
    } catch {
      state.incomplete = true;
      state.warnings.push("Diff could not be read; running all tasks.");
    }
  }
  state.warnings = [...new Set(state.warnings)];
  return state;
}
