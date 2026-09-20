import { mkdirSync, writeFileSync } from "node:fs";

const tasks = {
  auth: {
    command: "node -e \"console.log('auth tests')\"",
    when: "Could authentication, session or cookie behavior change?",
  },
  sdk: {
    command: "node -e \"console.log('SDK generation')\"",
    when: "Could the public API contract change?",
  },
  db: {
    command: "node -e \"console.log('database tests')\"",
    when: "Could database schemas or persistence change?",
  },
  benchmark: {
    command: "node -e \"console.log('benchmark')\"",
    when: "Could a performance-sensitive execution path materially change?",
  },
};
const cases = [
  [
    "auth-session-ttl",
    "src/auth.ts",
    "const TTL = 3600",
    "const TTL = 86400",
    ["auth"],
  ],
  [
    "api-response-field",
    "src/api.ts",
    "return {id}",
    "return {id, name}",
    ["sdk"],
  ],
  ["comment-only", "src/auth.ts", "// session", "// session duration", []],
  [
    "logging-only",
    "src/log.ts",
    'logger.info("start")',
    'logger.info("started")',
    [],
  ],
  ["db-schema", "schema.sql", "name TEXT", "name VARCHAR(100)", ["db"]],
  [
    "performance",
    "src/search.ts",
    "items.find(predicate)",
    "index.get(key)",
    ["benchmark"],
  ],
  ["docs-only", "README.md", "Install", "Installation", []],
];
mkdirSync("evals/fixtures", { recursive: true });
for (const [name, path, before, after, selected] of cases) {
  const fixture = {
    name,
    provenance:
      "Synthetic SDK-shaped responses, not recorded Jev output; live model quality is unverified.",
    config: { version: 1, tasks },
    state: {
      base: "fixture-base",
      head: "fixture-head",
      files: [{ path, status: "M" }],
      diff: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-${before}\n+${after}\n`,
      incomplete: false,
      warnings: [],
    },
    response: {
      model: "jev-1.13.0",
      probabilities: Object.fromEntries(
        Object.keys(tasks).map((id) => [
          id,
          selected.includes(id) ? 0.95 : 0.01,
        ]),
      ),
    },
    expected: Object.fromEntries(
      Object.keys(tasks).map((id) => [
        id,
        selected.includes(id) ? "run" : "skip",
      ]),
    ),
  };
  writeFileSync(
    `evals/fixtures/${name}.json`,
    `${JSON.stringify(fixture, null, 2)}\n`,
  );
}
