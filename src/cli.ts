#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { config as loadEnvFile } from "dotenv";
import { ConfigError, loadConfig, template } from "./config.js";
import { evaluate } from "./eval.js";
import { executePlan } from "./executor.js";
import { collectChanges, matches } from "./git.js";
import { createPlan, type Plan } from "./planner.js";

loadEnvFile({ quiet: true });

function render(plan: Plan) {
  return [
    `jev-affected\n\nBase ${plan.base}\nHead ${plan.head}\nModel ${plan.model ?? "not analyzed"}`,
    ...plan.warnings.map((w) => `Warning: ${w}`),
    "",
    ...plan.tasks.map(
      (t) =>
        `${t.decision.toUpperCase().padEnd(5)} ${t.id.padEnd(22)} ${t.probability?.toFixed(3) ?? "—"}  ${t.reason}`,
    ),
    "",
    `${plan.tasks.filter((t) => t.decision === "run").length} / ${plan.tasks.length} tasks selected`,
  ].join("\n");
}
async function main() {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        base: { type: "string" },
        head: { type: "string" },
        config: { type: "string" },
        json: { type: "boolean" },
        parallel: { type: "boolean" },
        concurrency: { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        "no-cache": { type: "boolean" },
        fixtures: { type: "string" },
        live: { type: "boolean" },
      },
    });
  } catch {
    throw new ConfigError("Invalid arguments. See --help.");
  }
  const { values: v, positionals } = args;
  const command = positionals[0];
  if (v.version) {
    console.log(
      JSON.parse(
        await readFile(new URL("../package.json", import.meta.url), "utf8"),
      ).version,
    );
    return;
  }
  if (v.help || !command) {
    console.log(`jev-affected — Semantic task routing, powered by Jev.

Usage: jev-affected <command> [options]
Commands: init, plan, run, why <task>, inspect, doctor, eval
Options:
  --base <ref>       Compare from merge-base(ref, head)
  --head <ref>       Head commit (default HEAD; committed changes only)
  --config <file>    YAML configuration
  --json            Machine-readable output
  --no-cache        Bypass the local decision cache
  --parallel        Execute selected commands concurrently
  --concurrency <n>  Maximum parallel commands
  --fixtures <dir>  Evaluation fixtures (default evals/fixtures)
  --live            Evaluate using the real Jev API
  --help, --version

inspect never sends requests. plan never executes task commands.`);
    return;
  }
  if (
    !["init", "plan", "run", "why", "inspect", "doctor", "eval"].includes(
      command,
    )
  )
    throw new ConfigError("Unknown command. See --help.");
  if (positionals.length > (command === "why" ? 2 : 1))
    throw new ConfigError("Unexpected positional arguments.");
  const emit = (x: unknown) => console.log(JSON.stringify(x, null, 2));
  if (command === "init") {
    try {
      await writeFile(String(v.config ?? "jev-affected.yml"), template, {
        flag: "wx",
      });
    } catch {
      throw new ConfigError(
        "Cannot create config: file already exists or directory is not writable.",
      );
    }
    if (v.json) emit({ created: v.config ?? "jev-affected.yml" });
    else
      console.log(
        "Created jev-affected.yml\n\nNext:\n  1. Set TYPESAFE_API_KEY\n  2. Define semantic task conditions\n  3. Run: jev-affected plan",
      );
    return;
  }
  if (command === "eval") {
    const result = await evaluate(
      v.fixtures
        ? resolve(String(v.fixtures))
        : fileURLToPath(new URL("../evals/fixtures", import.meta.url)),
      !!v.live,
    );
    emit(result);
    if (!result.passed) process.exitCode = 1;
    return;
  }
  const config = await loadConfig(String(v.config ?? "jev-affected.yml"));
  const opts = {
    config,
    base: typeof v.base === "string" ? v.base : undefined,
    head: typeof v.head === "string" ? v.head : undefined,
    cache: !v["no-cache"],
  };
  if (
    command === "why" &&
    (!positionals[1] || !Object.hasOwn(config.tasks, positionals[1]))
  )
    throw new ConfigError("Specify a configured task: why <task>.");
  if (command === "inspect") {
    const state = await collectChanges(config, opts);
    const questions = Object.fromEntries(
      Object.entries(config.tasks)
        .filter(
          ([, t]) =>
            !state.incomplete &&
            !t.always &&
            t.allowSkip &&
            state.files.some((f) =>
              [f.path, ...(f.oldPath ? [f.oldPath] : [])].some(
                (p) =>
                  (!t.include || matches(p, t.include)) &&
                  !matches(p, t.ignore),
              ),
            ),
        )
        .map(([id, t]) => [id, { type: "noul", instructions: t.when }]),
    );
    emit({
      state,
      model: config.model,
      questions,
      providerRequest: Object.keys(questions).length
        ? {
            model: config.model,
            state: {
              base: state.base,
              head: state.head,
              files: state.files,
              diff: state.diff,
            },
            questions,
          }
        : null,
      requestSent: false,
      note: "No request was sent. Incomplete states use safe fallback.",
    });
    return;
  }
  if (command === "doctor") {
    const checks: Record<string, boolean | string> = {
      node: Number(process.versions.node.split(".")[0]) >= 20,
      config: true,
      tasks: Object.keys(config.tasks).length.toString(),
      apiKey: !!process.env.TYPESAFE_API_KEY?.trim(),
    };
    try {
      await collectChanges(config, opts);
      checks.gitBase = true;
    } catch {
      checks.gitBase = false;
    }
    if (checks.apiKey) {
      try {
        await new TypeSafeClient({
          logLevel: "off",
          timeout: config.analysis.timeoutMs,
          retry: { maxRetries: 0 },
        }).models.list();
        checks.apiReachable = true;
      } catch {
        checks.apiReachable = false;
      }
    } else checks.apiReachable = false;
    emit(checks);
    if (Object.values(checks).includes(false)) process.exitCode = 2;
    return;
  }
  const plan = await createPlan(opts);
  if (command === "why") {
    const task = plan.tasks.find((t) => t.id === positionals[1]);
    emit({
      task,
      model: plan.model,
      base: plan.base,
      head: plan.head,
      warnings: plan.warnings,
    });
    return;
  }
  if (command === "run") {
    const n =
      v.concurrency === undefined
        ? config.execution.concurrency
        : Number(v.concurrency);
    if (!Number.isInteger(n) || n < 1 || n > 64)
      throw new ConfigError("concurrency must be an integer from 1 to 64");
    if (!v.json) console.log(render(plan));
    process.exitCode = await executePlan(plan, {
      concurrency: v.parallel || config.execution.parallel ? n : 1,
      json: !!v.json,
    });
    if (v.json) emit({ plan, exitCode: process.exitCode });
    return;
  }
  if (v.json) emit(plan);
  else console.log(render(plan));
}
main().catch((error) => {
  console.error(
    error instanceof ConfigError
      ? error.message
      : "Operation failed. Check Git, paths and file permissions.",
  );
  process.exitCode = error instanceof ConfigError ? 2 : 3;
});
