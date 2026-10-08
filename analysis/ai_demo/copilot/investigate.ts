// Offline check of the Flock Vet copilot: runs the same tool loop as src/app/api/agent/chat/route.ts
// (same model, prompt, tools and round cap) for one farm, without the browser or Clerk. Read-only.
//
// Usage, from the repository root (AWS credentials for SSM in the environment):
//   npx tsx analysis/ai_demo/copilot/investigate.ts "Investigate Saturday 26 September 2026 ..."
// Tool calls and timings go to stderr; the answer goes to stdout.

import { SSMClient, GetParametersByPathCommand } from "@aws-sdk/client-ssm";
import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, AGENT_MODEL } from "@/lib/anthropic";
import { AGENT_TOOLS, executeAgentTool, LocalFarmDataSource } from "@/lib/agentTools";
import { buildSystemPrompt } from "@/lib/flockVetPrompt";
import type { FarmConfig } from "@/lib/farms";

const FARM_ID = process.env.FARM_ID ?? "farm_anike_001";
const MAX_ITERATIONS = 6; // same cap as the route

async function farmConfig(): Promise<FarmConfig> {
  const ssm = new SSMClient({ region: process.env.AWS_REGION ?? "af-south-1" });
  let token: string | undefined;
  do {
    const res = await ssm.send(new GetParametersByPathCommand({ Path: "/senseagri/farms/", Recursive: true, WithDecryption: true, NextToken: token }));
    for (const p of res.Parameters ?? []) {
      if (!p.Name?.endsWith("/config") || !p.Value) continue;
      const cfg = JSON.parse(p.Value) as FarmConfig;
      if (cfg.farmId === FARM_ID) return cfg;
    }
    token = res.NextToken;
  } while (token);
  throw new Error(`No farm config with farmId ${FARM_ID}`);
}

async function main() {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) throw new Error("Pass the question as the argument.");
  const farm = await farmConfig();
  const client = await getAnthropicClient();
  const source = new LocalFarmDataSource(farm);
  const system = buildSystemPrompt(farm);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];
  const t0 = Date.now();
  const secs = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const resp = await client.messages.create({
      model: AGENT_MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system,
      tools: AGENT_TOOLS,
      messages,
    });
    if (resp.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: resp.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of resp.content) {
        if (block.type !== "tool_use") continue;
        const r = await executeAgentTool(source, block.name, block.input as Record<string, unknown>);
        console.error(`[${secs()}] ${block.name} ${JSON.stringify(block.input)} -> ${r.ok ? "ok" : `ERROR ${r.error}`}`);
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(r.ok ? r.data : { error: r.error }), is_error: !r.ok });
      }
      messages.push({ role: "user", content: results });
      continue;
    }
    console.log(resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim());
    console.error(`[${secs()}] done: ${resp.stop_reason}, ${i + 1} model call(s), ${resp.usage.input_tokens} in / ${resp.usage.output_tokens} out on the last call`);
    return;
  }
  console.error(`[${secs()}] hit the ${MAX_ITERATIONS}-round cap without a final answer`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
