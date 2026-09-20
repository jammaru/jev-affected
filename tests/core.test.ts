import { mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseConfig, resolveApiKey } from "../src/config.js";
import { evaluate } from "../src/eval.js";
import { executePlan } from "../src/executor.js";
import { type ChangeState, collectChanges, git } from "../src/git.js";
import { createPlan } from "../src/planner.js";

const state: ChangeState = {
  base: "a",
  head: "b",
  files: [{ path: "src/auth.ts", status: "M" }],
  diff: "-3600\n+86400",
  incomplete: false,
  warnings: [],
};
const config = parseConfig({
  version: 1,
  tasks: {
    auth: { command: 'node -e "process.exit(0)"', when: "Auth changes" },
    sdk: { command: 'node -e "process.exit(0)"', when: "API changes" },
    protected: {
      command: 'node -e "process.exit(0)"',
      always: true,
      include: ["never/**"],
    },
  },
});
const provider = (
  probabilities: Record<string, number>,
  model = "jev-1.13.0",
) => ({ analyze: vi.fn(async () => ({ model, probabilities })) });
describe("safe decisions", () => {
  it("reads API credentials from the process environment only", () => {
    expect(
      resolveApiKey({
        TYPESAFE_API_KEY: "  primary-key  ",
        TYPESAFEAI_API_KEY: "fallback-key",
      }),
    ).toBe("primary-key");
    expect(resolveApiKey({ TYPESAFEAI_API_KEY: "fallback-key" })).toBe(
      "fallback-key",
    );
    expect(resolveApiKey({})).toBeUndefined();
    expect(() =>
      parseConfig({
        version: 1,
        apiKey: "must-not-live-in-config",
        tasks: { a: { command: "true", when: "x" } },
      }),
    ).toThrow(/process environment/);
  });
  it("skips only strictly below threshold; protects always tasks", async () => {
    const p = provider({ auth: 0.1, sdk: 0.099 });
    const plan = await createPlan({ config, state, provider: p });
    expect(plan.tasks.map((t) => t.decision)).toEqual(["run", "skip", "run"]);
    expect(p.analyze.mock.calls).toHaveLength(1);
  });
  it.each([NaN, Infinity, -0.1, 1.1, undefined])(
    "runs on invalid probability %s",
    async (value) => {
      const plan = await createPlan({
        config,
        state,
        provider: provider({ auth: value as number, sdk: 0 }),
      });
      expect(plan.tasks[0]?.decision).toBe("run");
    },
  );
  it("falls back on errors without exposing their messages", async () => {
    const plan = await createPlan({
      config,
      state,
      provider: {
        analyze: async () => {
          throw new Error("secret API key");
        },
      },
    });
    expect(plan.tasks.every((t) => t.decision === "run")).toBe(true);
    expect(JSON.stringify(plan)).not.toContain("secret API key");
  });
  it("runs on missing actual model", async () => {
    const plan = await createPlan({
      config,
      state,
      provider: provider({ auth: 0, sdk: 0 }, "jev-latest"),
    });
    expect(plan.tasks.every((t) => t.decision === "run")).toBe(true);
  });
  it("does not send incomplete states", async () => {
    const p = provider({ auth: 0, sdk: 0 });
    const plan = await createPlan({
      config,
      state: { ...state, incomplete: true },
      provider: p,
    });
    expect(p.analyze).not.toHaveBeenCalled();
    expect(plan.tasks.every((t) => t.decision === "run")).toBe(true);
  });
  it("no changes avoids requests while retaining always tasks", async () => {
    const p = provider({});
    const plan = await createPlan({
      config,
      state: { ...state, files: [], diff: "" },
      provider: p,
    });
    expect(plan.tasks.map((t) => t.decision)).toEqual(["skip", "skip", "run"]);
    expect(p.analyze).not.toHaveBeenCalled();
  });
  it("evaluates both rename paths", async () => {
    const cfg = parseConfig({
      version: 1,
      tasks: { a: { command: "true", include: ["old/**"], when: "Change" } },
    });
    const p = provider({ a: 1 });
    const plan = await createPlan({
      config: cfg,
      state: {
        ...state,
        files: [
          { path: "new/file.ts", oldPath: "old/file.ts", status: "R100" },
        ],
      },
      provider: p,
    });
    expect(plan.tasks[0]?.decision).toBe("run");
    expect(p.analyze).toHaveBeenCalledOnce();
  });
  it("rejects unsafe or misspelled configuration", () => {
    expect(() =>
      parseConfig({
        version: 1,
        tasks: { a: { command: "true", when: "x", skipBelow: 2 } },
      }),
    ).toThrow();
    expect(() =>
      parseConfig({ version: 1, policy: { onError: "skip" }, tasks: {} }),
    ).toThrow();
    expect(() =>
      parseConfig({
        version: 1,
        tasks: { a: { command: "true", alway: true } },
      }),
    ).toThrow();
  });
  it("propagates command failures", async () => {
    const plan = await createPlan({
      config,
      state,
      provider: provider({ auth: 1, sdk: 0 }),
    });
    const first = plan.tasks[0];
    if (!first) throw new Error("Expected planned task");
    first.command = 'node -e "process.exit(7)"';
    expect(await executePlan(plan)).toBe(1);
  });
});
async function repo() {
  const cwd = await mkdtemp(join(tmpdir(), "jev-test-"));
  await git(cwd, "init", "-b", "main");
  await git(cwd, "config", "user.name", "Test");
  await git(cwd, "config", "user.email", "test@example.invalid");
  await writeFile(join(cwd, "auth.ts"), "export const ttl = 3600;\n");
  await git(cwd, "add", ".");
  await git(cwd, "commit", "-m", "initial");
  await git(cwd, "checkout", "-b", "change");
  return cwd;
}
describe("Git integration", () => {
  it("collects tracked and untracked working-tree changes", async () => {
    const cwd = await repo();
    await writeFile(join(cwd, "auth.ts"), "export const ttl = 7200;\n");
    await writeFile(join(cwd, "new file.ts"), "export const added = true;\n");
    const s = await collectChanges(config, {
      cwd,
      base: "HEAD",
      workingTree: true,
    });
    expect(s.head).toBe("WORKTREE");
    expect(s.files.map((file) => file.path)).toEqual([
      "auth.ts",
      "new file.ts",
    ]);
    expect(s.diff).toContain("7200");
    expect(s.diff).toContain("added = true");
    expect(s.incomplete).toBe(false);
  });
  it("does not mistake source text for a submodule patch", async () => {
    const cwd = await repo();
    await writeFile(
      join(cwd, "auth.ts"),
      'export const marker = "Subproject commit ";\n',
    );
    const s = await collectChanges(config, {
      cwd,
      base: "HEAD",
      workingTree: true,
    });
    expect(s.incomplete).toBe(false);
  });
  it("collects the index without later unstaged edits", async () => {
    const cwd = await repo();
    await writeFile(join(cwd, "auth.ts"), "export const ttl = 7200;\n");
    await git(cwd, "add", "auth.ts");
    await writeFile(join(cwd, "auth.ts"), "export const ttl = 14400;\n");
    const s = await collectChanges(config, { cwd, staged: true });
    expect(s.head).toBe("INDEX");
    expect(s.files.map((file) => file.path)).toEqual(["auth.ts"]);
    expect(s.diff).toContain("7200");
    expect(s.diff).not.toContain("14400");
  });
  it("rejects ambiguous working-tree modes", async () => {
    const cwd = await repo();
    await expect(
      collectChanges(config, { cwd, workingTree: true, staged: true }),
    ).rejects.toThrow(/not both/);
    await expect(
      collectChanges(config, { cwd, staged: true, base: "main" }),
    ).rejects.toThrow(/cannot be combined/);
  });
  it("collects committed diff and excludes secrets before transmission", async () => {
    const cwd = await repo();
    await writeFile(join(cwd, ".env"), "API_KEY=do-not-transmit");
    await writeFile(join(cwd, "auth.ts"), "export const ttl = 86400;\n");
    await git(cwd, "add", ".");
    await git(cwd, "commit", "-m", "change");
    const s = await collectChanges(config, { cwd });
    expect(s.incomplete).toBe(true);
    expect(s.diff).not.toContain("do-not-transmit");
    expect(s.files.map((f) => f.path)).toEqual(["auth.ts"]);
    expect(s.diff).toContain("86400");
  });
  it("handles renames with spaces", async () => {
    const cwd = await repo();
    await rename(join(cwd, "auth.ts"), join(cwd, "new auth.ts"));
    await git(cwd, "add", ".");
    await git(cwd, "commit", "-m", "rename");
    const s = await collectChanges(config, { cwd });
    expect(s.files[0]?.oldPath).toBe("auth.ts");
    expect(s.files[0]?.path).toBe("new auth.ts");
  });
  it("oversized diffs force fallback", async () => {
    const cwd = await repo();
    await writeFile(join(cwd, "auth.ts"), "x".repeat(1000));
    await git(cwd, "add", ".");
    await git(cwd, "commit", "-m", "large");
    const s = await collectChanges(
      { ...config, analysis: { ...config.analysis, maxDiffBytes: 10 } },
      { cwd },
    );
    expect(s.incomplete).toBe(true);
    expect(s.diff).toBe("");
  });
  it("never overwrites init configuration", async () => {
    const cwd = await repo();
    const path = join(cwd, "jev-affected.yml");
    await writeFile(path, "original");
    await expect(
      writeFile(path, "replacement", { flag: "wx" }),
    ).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("original");
  });
});
it("offline evaluation has zero false skips and meaningful reduction", async () => {
  const result = await evaluate("evals/fixtures");
  expect(result.falseSkips).toBe(0);
  expect(result.passed).toBe(true);
  expect(result.taskReduction).toBeGreaterThan(0.3);
  expect(result.cases.length).toBe(7);
});
