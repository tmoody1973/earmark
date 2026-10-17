import { getEnv } from "../env";

export async function photoDecisionModel(): Promise<string> {
  return getEnv().BENCHMARK_MODEL; // "openai/gpt-6-luna-decisions" via AI Gateway; image input verified in M5-T2 Step 2
}
