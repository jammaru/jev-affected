import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";
export class ConfigError extends Error {}
export const API_KEY_VARS = ["TYPESAFE_API_KEY", "TYPESAFEAI_API_KEY"] as const;
const probability = z.number().min(0).max(1);
const limits = z
  .object({
    skipBelow: probability.optional(),
    threshold: probability.optional(),
  })
  .strict()
  .refine(
    (x) => x.skipBelow === undefined || x.threshold === undefined,
    "Use skipBelow or threshold, not both",
  );
const patterns = z.array(z.string().min(1));
export const secretPatterns = [
  "**/.env*",
  "**/*.pem",
  "**/*.key",
  "**/*credentials*",
  "**/*secret*",
  "**/*token*",
];
export const configSchema = z
  .object({
    version: z.literal(1),
    model: z.string().min(1).default("jev-latest"),
    base: z.string().min(1).optional(),
    policy: z
      .object({
        uncertain: z.literal("run").default("run"),
        onError: z.literal("run").default("run"),
      })
      .strict()
      .default({ uncertain: "run", onError: "run" }),
    defaults: limits.default({ skipBelow: 0.1 }),
    ignore: patterns.default([]),
    analysis: z
      .object({
        maxDiffBytes: z.number().int().positive().default(100000),
        timeoutMs: z.number().int().positive().default(10000),
        exclude: patterns.default([]),
      })
      .strict()
      .default({ maxDiffBytes: 100000, timeoutMs: 10000, exclude: [] }),
    execution: z
      .object({
        parallel: z.boolean().default(false),
        concurrency: z.number().int().min(1).max(64).default(4),
      })
      .strict()
      .default({ parallel: false, concurrency: 4 }),
    tasks: z
      .record(
        z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
        z
          .object({
            command: z.string().trim().min(1),
            when: z.string().trim().min(1).optional(),
            always: z.boolean().default(false),
            allowSkip: z.boolean().default(true),
            include: patterns.optional(),
            ignore: patterns.default([]),
            skipBelow: probability.optional(),
            threshold: probability.optional(),
          })
          .strict()
          .refine(
            (t) => t.always || !t.allowSkip || !!t.when,
            "when is required for skippable tasks",
          )
          .refine(
            (t) => t.skipBelow === undefined || t.threshold === undefined,
            "Use skipBelow or threshold, not both",
          ),
      )
      .refine(
        (t) => Object.keys(t).length > 0,
        "At least one task is required",
      ),
  })
  .strict();
export type Config = z.infer<typeof configSchema>;
export function parseConfig(value: unknown): Config {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const source = value as Record<string, unknown>;
    if (Object.hasOwn(source, "apiKey") || Object.hasOwn(source, "api_key"))
      throw new ConfigError(
        "API keys are not supported in jev-affected.yml. Set TYPESAFE_API_KEY in the process environment or CI secret store.",
      );
  }
  const r = configSchema.safeParse(value);
  if (!r.success)
    throw new ConfigError(
      r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"),
    );
  return r.data;
}
export function resolveApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  for (const name of API_KEY_VARS) {
    const value = env[name]?.trim();
    if (value) return value;
  }
}
export async function loadConfig(path = "jev-affected.yml"): Promise<Config> {
  try {
    return parseConfig(parse(await readFile(path, "utf8")));
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    throw new ConfigError("Cannot read or parse YAML configuration.");
  }
}
export const template = `version: 1
model: jev-latest
defaults:
  skipBelow: 0.10
tasks:
  unit:
    command: npm test
    when: Could this change alter runtime application behavior?
  typecheck:
    command: npm run typecheck
    always: true
`;
