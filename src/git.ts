import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
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
export interface ChangeOptions {
  cwd?: string;
  base?: string;
  head?: string;
  workingTree?: boolean;
  staged?: boolean;
}
const branchRefs = (value: string | undefined) => {
  const branch = value?.trim().replace(/^refs\/heads\//, "");
  if (!branch || branch === "false") return [];
  if (branch.startsWith("origin/") || /^[0-9a-f]{7,40}$/.test(branch))
    return [branch];
  return [`origin/${branch}`, branch];
};
export function detectCiBaseCandidates(env: NodeJS.ProcessEnv = process.env) {
  const refs = [
    ...branchRefs(env.GITHUB_BASE_REF),
    ...(env.GITLAB_CI === "true"
      ? [
          ...branchRefs(env.CI_MERGE_REQUEST_DIFF_BASE_SHA),
          ...branchRefs(env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME),
          ...branchRefs(env.CI_DEFAULT_BRANCH),
        ]
      : []),
    ...(env.BUILDKITE === "true"
      ? branchRefs(env.BUILDKITE_PULL_REQUEST_BASE_BRANCH)
      : []),
    ...(env.CIRCLECI === "true" ? branchRefs(env.CIRCLE_PR_BASE_BRANCH) : []),
  ];
  return [...new Set(refs)];
}
const hasUnsupportedPatch = (patch: string) =>
  /^Binary files .+ differ$/m.test(patch) ||
  /^[+-]Subproject commit [0-9a-f]{7,}(?:-dirty)?$/m.test(patch);
async function untrackedPatch(cwd: string, path: string) {
  try {
    return await git(
      cwd,
      "diff",
      "--no-index",
      "--no-ext-diff",
      "--no-textconv",
      "--unified=3",
      "--",
      "/dev/null",
      path,
    );
  } catch (error) {
    const result = error as { code?: number | string; stdout?: string };
    if (Number(result.code) === 1 && typeof result.stdout === "string")
      return result.stdout;
    throw error;
  }
}
export async function collectChanges(
  config: Config,
  options: ChangeOptions = {},
): Promise<ChangeState> {
  const cwd = options.cwd ?? process.cwd();
  if (options.workingTree && options.staged)
    throw new ConfigError("Use --working-tree or --staged, not both.");
  if (options.workingTree && options.head)
    throw new ConfigError("--working-tree cannot be combined with --head.");
  if (options.staged && (options.base || options.head))
    throw new ConfigError("--staged cannot be combined with --base or --head.");
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
  let headCommit: string;
  try {
    headCommit = await resolve(options.head ?? "HEAD");
  } catch {
    throw new ConfigError("Cannot resolve head commit.");
  }
  const explicit = options.staged ? "HEAD" : (options.base ?? config.base);
  const candidates = explicit
    ? [explicit]
    : [
        ...detectCiBaseCandidates(),
        "origin/HEAD",
        "origin/main",
        "main",
        "master",
      ];
  let base: string | undefined;
  for (const ref of candidates) {
    try {
      base = options.staged
        ? await resolve("HEAD")
        : (await git(cwd, "merge-base", await resolve(ref), headCommit)).trim();
      break;
    } catch {}
  }
  if (!base)
    throw new ConfigError(
      "Cannot resolve Git base. Fetch the base branch or pass --base.",
    );
  const comparison = options.staged
    ? ["--cached", base]
    : options.workingTree
      ? [base]
      : [base, headCommit];
  const parts = (
    await git(
      cwd,
      "diff",
      "--name-status",
      "-z",
      "--find-renames",
      ...comparison,
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
  if (options.workingTree) {
    const tracked = new Set(
      files.flatMap((file) => [
        file.path,
        ...(file.oldPath ? [file.oldPath] : []),
      ]),
    );
    for (const path of (
      await git(cwd, "ls-files", "--others", "--exclude-standard", "-z", "--")
    ).split("\0")) {
      if (path && !tracked.has(path)) files.push({ status: "A", path });
    }
  }
  const state: ChangeState = {
    base,
    head: options.staged
      ? "INDEX"
      : options.workingTree
        ? "WORKTREE"
        : headCommit,
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
      if (options.workingTree && file.status === "A") {
        const size = (await stat(resolvePath(cwd, file.path))).size;
        if (
          Buffer.byteLength(state.diff) + size >
          config.analysis.maxDiffBytes
        ) {
          state.incomplete = true;
          state.warnings.push(
            "Diff exceeds analysis limit; running all tasks.",
          );
          continue;
        }
      }
      const patch =
        options.workingTree && file.status === "A"
          ? await untrackedPatch(cwd, file.path)
          : await git(
              cwd,
              "diff",
              "--no-ext-diff",
              "--no-textconv",
              "--find-renames",
              "--unified=3",
              ...(options.staged ? ["--cached", base] : comparison),
              "--",
              ...paths,
            );
      if (hasUnsupportedPatch(patch)) {
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
