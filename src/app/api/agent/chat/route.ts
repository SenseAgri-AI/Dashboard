import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { getFarmForRequest, FarmAccessError } from "@/lib/farms";
import { getAnthropicClient, AGENT_MODEL, AssistantNotConfiguredError } from "@/lib/anthropic";
import { AGENT_TOOLS, executeAgentTool, LocalFarmDataSource } from "@/lib/agentTools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The Flock Vet chat endpoint. Owns the agentic loop: farm scope is injected from the
// caller's Clerk org (never from the model), then Claude runs against farm-scoped tools
// until it produces a final answer. The client holds the conversation history (no DB) and
// POSTs the running message list, matching the rest of the app.

const MAX_ITERATIONS = 6; // cap tool-use rounds so the loop always terminates
const MAX_HISTORY = 24; // trim old turns to bound token cost
const MAX_MSG_CHARS = 6000;

type InboundMessage = { role: "user" | "assistant"; content: string };

function buildSystemPrompt(farm: { farmId: string; houseHens: Record<string, number> }): string {
  const today = new Date().toISOString().slice(0, 10);
  const houses = Object.entries(farm.houseHens)
    .map(([id, hens]) => `${id} (${hens.toLocaleString()} hens placed)`)
    .join(", ") || "none configured";
  const total = Object.values(farm.houseHens).reduce((a, b) => a + b, 0);

  return [
    "You are Flock Vet, an AI poultry-layer veterinary and husbandry advisor built into the SenseAgri farm dashboard.",
    "You help a commercial egg farmer understand and improve their flock by reasoning over THEIR OWN farm data.",
    "",
    "## This farm",
    `- Today's date: ${today}.`,
    `- Houses: ${houses}. Total starting hens: ${total.toLocaleString()}.`,
    "- All tools are already scoped to this farm; you cannot see any other farm's data.",
    "",
    "## How to answer",
    "- ALWAYS ground quantitative claims in tool output. Call a tool before stating any number — never invent or estimate figures from memory. Begin most questions with get_flock_snapshot to orient yourself.",
    "- Choose tools deliberately: query_flock_history for trends over time, get_recent_environment for air/heat/ventilation, compare_to_breed_standard to judge lay rate against age, get_events / get_schedule to correlate with interventions and routines.",
    "- If data is missing or the daily log is stale, say so plainly rather than guessing. Note the timeframe your conclusion is based on.",
    "- Keep answers concise, structured and actionable — lead with the direct answer, then the supporting numbers, then what to do next.",
    "",
    "## Veterinary scope & safety",
    "- You provide decision-support, not a diagnosis, and you are not a substitute for a licensed veterinarian examining the birds.",
    "- Offer possible causes (e.g. IB, EDS, ND, coccidiosis, heat stress, nutritional issues) as differentials to consider, never as confirmed diagnoses.",
    "- For urgent or serious signs — sudden high mortality, neurological or respiratory disease, or any suspected notifiable disease — advise the farmer to contact a licensed veterinarian or their local animal-health authority promptly.",
    "- Cover layer topics: lay-rate drops, mortality spikes, heat stress, ventilation / CO₂ / ammonia, egg quality (shell, weight, breakage), FCR and nutrition, and biosecurity.",
    "- End with a brief reminder to consult a vet when the situation is clinical or you are recommending medication.",
  ].join("\n");
}

export async function POST(request: Request) {
  // 1. Farm scope (server-side, from Clerk org).
  let farm;
  try {
    farm = await getFarmForRequest();
  } catch (err) {
    if (err instanceof FarmAccessError) return NextResponse.json({ error: err.message }, { status: 403 });
    return NextResponse.json({ error: "Failed to resolve farm" }, { status: 500 });
  }

  // 2. Anthropic client (503 until the key is provisioned in SSM).
  let client: Anthropic;
  try {
    client = await getAnthropicClient();
  } catch (err) {
    if (err instanceof AssistantNotConfiguredError) {
      return NextResponse.json({ error: err.message, notConfigured: true }, { status: 503 });
    }
    console.error("Anthropic client error:", err);
    return NextResponse.json({ error: "Assistant is unavailable" }, { status: 500 });
  }

  // 3. Parse + sanitise the client-held history.
  let body: { messages?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const inbound = Array.isArray(body.messages) ? body.messages : [];
  const history: InboundMessage[] = inbound
    .filter((m): m is InboundMessage =>
      !!m && typeof m === "object" &&
      ((m as InboundMessage).role === "user" || (m as InboundMessage).role === "assistant") &&
      typeof (m as InboundMessage).content === "string" &&
      (m as InboundMessage).content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MSG_CHARS) }))
    .slice(-MAX_HISTORY);

  if (!history.length || history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "Expected a non-empty message history ending with a user message" }, { status: 400 });
  }

  const source = new LocalFarmDataSource(farm);
  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
  const system = buildSystemPrompt(farm);
  const toolsUsed: string[] = [];

  // 4. The agentic loop.
  try {
    let answer = "";
    let truncated = false;
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
        // Preserve the assistant turn verbatim (incl. thinking blocks) — required to continue.
        messages.push({ role: "assistant", content: resp.content });
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of resp.content) {
          if (block.type === "tool_use") {
            toolsUsed.push(block.name);
            const result = await executeAgentTool(source, block.name, block.input as Record<string, unknown>);
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(result.ok ? result.data : { error: result.error }),
              is_error: !result.ok,
            });
          }
        }
        messages.push({ role: "user", content: toolResults });
        continue;
      }

      answer = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      truncated = resp.stop_reason === "max_tokens";
      break;
    }

    if (!answer) {
      answer = "I wasn't able to finish working through your farm's data just now. Please try rephrasing, or ask about a narrower timeframe.";
    }
    if (truncated) answer += "\n\n_(Response was cut short — ask a follow-up for the rest.)_";

    return NextResponse.json({
      reply: answer,
      toolsUsed: [...new Set(toolsUsed)],
    });
  } catch (err) {
    console.error("Agent chat error:", err);
    return NextResponse.json({ error: "The assistant hit an error while reasoning over your data." }, { status: 500 });
  }
}
