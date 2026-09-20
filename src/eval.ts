import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ConfigError, parseConfig } from "./config.js";
import { createPlan } from "./planner.js";
import { JevProvider } from "./provider.js";
export async function evaluate(directory: string, live = false) {
  let required = 0,
    unneeded = 0,
    falseSkips = 0,
    unnecessaryRuns = 0,
    skipped = 0,
    total = 0,
    apiCalls = 0,
    latencyMs = 0,
    invalidCases = 0,
    reducedCases = 0,
    inputTokens = 0,
    outputTokens = 0;
  const cases = [];
  for (const file of (await readdir(directory))
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const fixture = JSON.parse(
      await readFile(resolve(directory, file), "utf8"),
    );
    const config = parseConfig(fixture.config);
    if (
      !fixture.expected ||
      Object.keys(fixture.expected).length !== Object.keys(config.tasks).length
    )
      throw new ConfigError("Each evaluation task needs an expected decision.");
    const plan = await createPlan({
      config,
      state: fixture.state,
      cache: false,
      provider: live
        ? new JevProvider()
        : { analyze: async () => fixture.response },
    });
    let misses = 0;
    for (const t of plan.tasks) {
      const expected = fixture.expected[t.id];
      if (expected !== "run" && expected !== "skip")
        throw new ConfigError("Invalid evaluation expectation");
      total++;
      if (t.decision === "skip") skipped++;
      if (expected === "run") {
        required++;
        if (t.decision === "skip") {
          falseSkips++;
          misses++;
        }
      } else {
        unneeded++;
        if (t.decision === "run") unnecessaryRuns++;
      }
    }
    apiCalls += live ? plan.metrics.apiCalls : 0;
    inputTokens += plan.metrics.usage?.input_tokens ?? 0;
    outputTokens += plan.metrics.usage?.output_tokens ?? 0;
    if (
      plan.tasks.some((t) =>
        ["provider-fallback", "invalid-answer", "incomplete-state"].includes(
          t.reason,
        ),
      )
    )
      invalidCases++;
    if (plan.tasks.some((t) => t.decision === "skip")) reducedCases++;
    latencyMs += plan.metrics.latencyMs;
    cases.push({
      name: fixture.name,
      falseSkips: misses,
      model: plan.model,
      usage: plan.metrics.usage,
      selected: plan.tasks.filter((t) => t.decision === "run").length,
      tasks: plan.tasks.map((t) => ({
        id: t.id,
        expected: fixture.expected[t.id],
        decision: t.decision,
        probability: t.probability,
        threshold: t.threshold,
        reason: t.reason,
      })),
    });
  }
  if (!cases.length) throw new ConfigError("No evaluation fixtures found.");
  return {
    mode: live ? "live" : "synthetic-offline",
    cases,
    falseSkips,
    invalidCases,
    reducedCases,
    passed:
      falseSkips === 0 &&
      invalidCases === 0 &&
      reducedCases >= 2 &&
      (total ? skipped / total : 0) >= 0.25,
    falseSkipRate: required ? falseSkips / required : 0,
    unnecessaryRunRate: unneeded ? unnecessaryRuns / unneeded : 0,
    taskReduction: total ? skipped / total : 0,
    apiCalls,
    latencyMs,
    usage: { inputTokens, outputTokens },
    gate: {
      maxFalseSkips: 0,
      maxInvalidCases: 0,
      minReducedCases: 2,
      minTaskReduction: 0.25,
    },
    analysisCost: null,
  };
}
