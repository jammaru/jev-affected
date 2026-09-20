import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parseConfig } from "../src/config.js";
import { git } from "../src/git.js";
import { createPlan } from "../src/planner.js";
import { JevProvider } from "../src/provider.js";

const state = {
  base: "a",
  head: "b",
  files: [{ path: "src/a.ts", status: "M" }],
  diff: "-a\n+b",
  incomplete: false,
  warnings: [],
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function transport() {
  vi.stubEnv("TYPESAFE_API_KEY", "test-key-not-real");
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: { a: { type: "noul", noul: 0.01 } },
          usage: { input_tokens: 10, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
it("uses the official SDK request and reads Noul, actual model and usage", async () => {
  const fetch = transport();
  const r = await new JevProvider().analyze({
    state,
    questions: { a: "Could API change?" },
    model: "jev-latest",
    timeoutMs: 1000,
  });
  expect(r.probabilities.a).toBe(0.01);
  expect(r.model).toBe("jev-1.13.0");
  const init = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(String(init[1].body)).questions.a).toEqual({
    type: "noul",
    instructions: "Could API change?",
  });
});
it("reuses only pinned-model cache and invalidates changed questions", async () => {
  const fetch = transport();
  const cwd = await mkdtemp(join(tmpdir(), "jev-cache-"));
  await git(cwd, "init");
  const config = parseConfig({
    version: 1,
    model: "jev-1.13.0",
    tasks: { a: { command: "true", when: "API changes" } },
  });
  const first = await createPlan({ config, state, cwd });
  const second = await createPlan({ config, state, cwd });
  expect(first.tasks[0]?.decision).toBe("skip");
  expect(second.metrics.cacheHits).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  await createPlan({
    config: {
      ...config,
      tasks: parseConfig({
        version: 1,
        tasks: { a: { command: "true", when: "Other behavior" } },
      }).tasks,
    },
    state,
    cwd,
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("does not cache moving aliases", async () => {
  const fetch = transport();
  const config = parseConfig({
    version: 1,
    tasks: { a: { command: "true", when: "API changes" } },
  });
  await createPlan({ config, state });
  await createPlan({ config, state });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("does not transmit sensitive caller-supplied state", async () => {
  const fetch = transport();
  const config = parseConfig({
    version: 1,
    tasks: { a: { command: "true", when: "API changes" } },
  });
  const plan = await createPlan({
    config,
    state: { ...state, files: [{ path: ".env", status: "M" }] },
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(plan.tasks[0]?.decision).toBe("run");
});
