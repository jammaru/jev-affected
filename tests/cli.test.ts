import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { beforeAll, expect, it } from "vitest";
import { git } from "../src/git.js";

const exec = promisify(execFile),
  cli = resolve("dist/cli.js");
let cwd: string;
beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), "jev-cli-"));
  await git(cwd, "init", "-b", "main");
  await git(cwd, "config", "user.name", "Test");
  await git(cwd, "config", "user.email", "test@example.invalid");
  await writeFile(join(cwd, "a.txt"), "old");
  await git(cwd, "add", ".");
  await git(cwd, "commit", "-m", "base");
  await git(cwd, "checkout", "-b", "change");
  await writeFile(join(cwd, "a.txt"), "new");
  await git(cwd, "add", ".");
  await git(cwd, "commit", "-m", "change");
  await writeFile(
    join(cwd, "jev-affected.yml"),
    `version: 1\ntasks:\n  task:\n    command: node -e "console.log('task-output')"\n    when: Could behavior change?\n`,
  );
});
const run = (...args: string[]) =>
  exec(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, TYPESAFE_API_KEY: "" },
  });
it("plan JSON stays parseable when no API key exists", async () => {
  const r = await run("plan", "--json");
  const p = JSON.parse(r.stdout);
  expect(p.tasks[0].decision).toBe("run");
  expect(p.tasks[0].reason).toBe("provider-fallback");
});
it("run routes child stdout to stderr in JSON mode", async () => {
  const r = await run("run", "--json");
  expect(JSON.parse(r.stdout).exitCode).toBe(0);
  expect(r.stderr).toContain("task-output");
});
it("inspect never needs an API key and shows the sanitized diff", async () => {
  const r = await run("inspect");
  const p = JSON.parse(r.stdout);
  expect(p.state.diff).toContain("+new");
  expect(p.note).toContain("No request was sent");
});
it("invalid arguments and unknown tasks exit 2", async () => {
  await expect(run("plan", "--typo")).rejects.toMatchObject({ code: 2 });
  await expect(run("why", "missing")).rejects.toMatchObject({ code: 2 });
  await expect(run("plan", "--working-tree", "--staged")).rejects.toMatchObject(
    { code: 2 },
  );
});
it("init refuses to overwrite an existing config", async () => {
  await expect(run("init")).rejects.toMatchObject({ code: 2 });
});
