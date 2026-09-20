import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cacheDirectory } from "./cache.js";
import {
  type Config,
  parseConfig,
  resolveApiKey,
  secretPatterns,
} from "./config.js";
import {
  type ChangeOptions,
  type ChangeState,
  collectChanges,
  matches,
} from "./git.js";
import {
  type AnalysisResult,
  type DecisionProvider,
  JevProvider,
} from "./provider.js";
export interface TaskDecision {
  id: string;
  command: string;
  condition?: string;
  decision: "run" | "skip";
  probability: number | null;
  threshold: number;
  reason: string;
  files: string[];
}
export interface Plan {
  version: 1;
  base: string;
  head: string;
  model: string | null;
  requestedModel: string;
  tasks: TaskDecision[];
  warnings: string[];
  metrics: {
    apiCalls: number;
    cacheHits: number;
    latencyMs: number;
    usage?: AnalysisResult["usage"];
  };
}
export async function createPlan(
  input: {
    config: Config;
    state?: ChangeState;
    provider?: DecisionProvider;
    cache?: boolean;
  } & ChangeOptions,
): Promise<Plan> {
  const start = Date.now(),
    config = parseConfig(input.config),
    cwd = input.cwd ?? process.cwd();
  const state = structuredClone(
    input.state ?? (await collectChanges(config, input)),
  );
  if (
    Buffer.byteLength(state.diff) > config.analysis.maxDiffBytes ||
    state.files.some((f) =>
      [f.path, ...(f.oldPath ? [f.oldPath] : [])].some((p) =>
        matches(p, [...secretPatterns, ...config.analysis.exclude]),
      ),
    )
  ) {
    state.incomplete = true;
    state.diff = "";
    state.warnings.push(
      "Supplied state exceeds analysis limits or includes excluded paths; running all tasks.",
    );
  }
  const plan: Plan = {
    version: 1,
    base: state.base,
    head: state.head,
    model: null,
    requestedModel: config.model,
    tasks: [],
    warnings: [...state.warnings],
    metrics: { apiCalls: 0, cacheHits: 0, latencyMs: 0 },
  };
  const questions: Record<string, string> = Object.create(null);
  for (const [id, t] of Object.entries(config.tasks)) {
    const files = state.files
      .filter((f) =>
        [f.path, ...(f.oldPath ? [f.oldPath] : [])].some(
          (p) => (!t.include || matches(p, t.include)) && !matches(p, t.ignore),
        ),
      )
      .map((f) => f.path);
    const task: TaskDecision = {
      id,
      command: t.command,
      condition: t.when,
      decision: "run",
      probability: null,
      threshold:
        t.skipBelow ??
        t.threshold ??
        config.defaults.skipBelow ??
        config.defaults.threshold ??
        0.1,
      reason: "semantic",
      files,
    };
    if (t.always || !t.allowSkip) task.reason = "protected";
    else if (state.incomplete) task.reason = "incomplete-state";
    else if (!files.length) {
      task.decision = "skip";
      task.reason = "no-matching-changes";
    } else if (t.when) questions[id] = t.when;
    plan.tasks.push(task);
  }
  if (Object.keys(questions).length) {
    let result: AnalysisResult | undefined;
    let cachePath: string | undefined;
    const pinned = /^jev-\d+\.\d+\.\d+$/.test(config.model);
    if (input.cache !== false && !input.provider && pinned) {
      try {
        const dir = await cacheDirectory(cwd);
        const key = createHash("sha256")
          .update(
            JSON.stringify({
              version: 1,
              model: config.model,
              config,
              questions,
              state,
            }),
          )
          .digest("hex");
        cachePath = resolve(dir, `${key}.json`);
        const cached = JSON.parse(await readFile(cachePath, "utf8"));
        if (cached.model === config.model) {
          result = cached;
          plan.metrics.cacheHits = 1;
        }
      } catch {}
    }
    try {
      if (!result) {
        plan.metrics.apiCalls = 1;
        result = await (input.provider ?? new JevProvider()).analyze({
          state,
          questions,
          model: config.model,
          timeoutMs: config.analysis.timeoutMs,
          apiKey: resolveApiKey(),
        });
      }
      if (!result.model || !/^jev-\d+\.\d+\.\d+$/.test(result.model))
        throw new Error("Missing actual model version");
      plan.model = result.model;
      plan.metrics.usage = result.usage;
      for (const task of plan.tasks) {
        if (!(task.id in questions)) continue;
        const p = result.probabilities[task.id];
        if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) {
          task.reason = "invalid-answer";
          continue;
        }
        task.probability = p;
        task.decision = p < task.threshold ? "skip" : "run";
      }
      if (
        cachePath &&
        result.model === config.model &&
        plan.tasks.every((t) => t.reason !== "invalid-answer")
      ) {
        try {
          await mkdir(resolve(cachePath, ".."), { recursive: true });
          await writeFile(cachePath, JSON.stringify(result), { mode: 0o600 });
        } catch {
          plan.warnings.push("Cache could not be written.");
        }
      }
    } catch {
      for (const t of plan.tasks) {
        if (t.id in questions) {
          t.decision = "run";
          t.probability = null;
          t.reason = "provider-fallback";
        }
      }
      plan.warnings.push(
        "Jev unavailable or response invalid; running candidate tasks.",
      );
    }
  }
  plan.metrics.latencyMs = Date.now() - start;
  return plan;
}
