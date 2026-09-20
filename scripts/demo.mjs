import { readFile } from "node:fs/promises";
import { createPlan, executePlan, parseConfig } from "../dist/index.js";

const fixture = JSON.parse(
  await readFile(
    new URL("../evals/fixtures/auth-session-ttl.json", import.meta.url),
    "utf8",
  ),
);
fixture.config.tasks.unit = {
  command: "node -e \"console.log('unit example complete')\"",
  always: true,
};
console.log("Illustrative offline fixture — not live Jev output\n");
console.log(fixture.state.diff);
const plan = await createPlan({
  config: parseConfig(fixture.config),
  state: fixture.state,
  cache: false,
  provider: { analyze: async () => fixture.response },
});
for (const task of plan.tasks)
  console.log(
    `${task.decision.toUpperCase().padEnd(5)} ${task.id.padEnd(15)} ${task.probability}`,
  );
console.log(
  `\n${plan.tasks.filter((t) => t.decision === "run").length} / ${plan.tasks.length} tasks selected\n`,
);
process.exitCode = await executePlan(plan);
