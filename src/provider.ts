import { noul, TypeSafeClient } from "@typesafe-ai/sdk";
import type { ChangeState } from "./git.js";
export interface AnalysisInput {
  state: ChangeState;
  questions: Record<string, string>;
  model: string;
  timeoutMs: number;
}
export interface AnalysisResult {
  model: string;
  probabilities: Record<string, number>;
  usage?: { input_tokens: number; output_tokens: number };
}
export interface DecisionProvider {
  analyze(input: AnalysisInput): Promise<AnalysisResult>;
}
export class JevProvider implements DecisionProvider {
  async analyze(input: AnalysisInput): Promise<AnalysisResult> {
    const client = new TypeSafeClient({
      logLevel: "off",
      timeout: input.timeoutMs,
      retry: { maxRetries: 0 },
    });
    const response = await client.systemOne({
      model: input.model,
      state: {
        base: input.state.base,
        head: input.state.head,
        files: input.state.files.map((f) => ({ ...f })),
        diff: input.state.diff,
      },
      questions: Object.fromEntries(
        Object.entries(input.questions).map(([id, q]) => [id, noul(q)]),
      ),
    });
    return {
      model: response.model,
      probabilities: Object.fromEntries(
        Object.entries(response.answers).map(([id, a]) => [
          id,
          a.type === "noul" ? a.noul : Number.NaN,
        ]),
      ),
      usage: response.usage,
    };
  }
}
