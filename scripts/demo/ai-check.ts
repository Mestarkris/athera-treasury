// pnpm ai:check — one tiny call per approved model to confirm NEARAI_API_KEY works. Never prints the key.
import { NearAiClient } from "@athera/agents";
import { PolicyEngine } from "@athera/policy";
import { CONFIG_PATH, loadEnv } from "./wire.ts";

loadEnv();
const ai = new NearAiClient(process.env["NEARAI_API_KEY"] || undefined);
if (!ai.hasKey) {
  console.error("NEARAI_API_KEY is not set in .env. Run: bash scripts/add-ai-key.sh");
  process.exit(2);
}
const models = PolicyEngine.load(CONFIG_PATH).config.inference?.approved_models ?? [];
let failed = 0;
for (const model of models) {
  try {
    const r = await ai.chat({ model, messages: [{ role: "user", content: 'Reply with the JSON {"ok":true} only.' }], maxTokens: 20, json: true });
    console.log(`OK  ${model}  reply ${JSON.stringify(r.content.slice(0, 60))}  tokens ${r.promptTokens}+${r.completionTokens}  cost $${(Number(r.costMicros) / 1e6).toFixed(6)}`);
  } catch (e) {
    failed++;
    console.log(`BAD ${model}  ${String(e).slice(0, 200)}`);
  }
}
process.exit(failed ? 1 : 0);
