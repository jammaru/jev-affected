import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (args, cwd) =>
  execFileSync(npm, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
const packed = JSON.parse(run(["pack", "--json"], process.cwd()))[0];
const cwd = mkdtempSync(join(tmpdir(), "jev-smoke-"));
run(["init", "-y"], cwd);
run(
  [
    "install",
    process.platform === "win32"
      ? `"${resolve(packed.filename)}"`
      : resolve(packed.filename),
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ],
  cwd,
);
const output = run(["exec", "--", "jev-affected", "--help"], cwd);
if (!output.includes("Semantic task routing"))
  throw new Error("Package smoke test failed");
console.log("Tarball installed and CLI --help passed.");
const evaluation = JSON.parse(run(["exec", "--", "jev-affected", "eval"], cwd));
if (!evaluation.passed) throw new Error("Packaged evaluation fixtures failed");
console.log("Packaged offline evaluation passed.");
