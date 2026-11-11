// Chat-completions client for the AI analyst (F6), over any OpenAI-compatible endpoint (AI_BASE_URL, AI_API_KEY,
// AI_MODEL). It sends only options every supported provider accepts: no temperature, tool_choice "auto", and no
// response_format (Anthropic's compatibility layer rejects the first two otherwise; Gemini supports only "auto").

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ToolSpec = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

export class AiOffError extends Error {}
export class AiLimitError extends Error {}

export type Complete = (messages: ChatMessage[], tools: ToolSpec[]) => Promise<{ content: string | null; tool_calls?: ToolCall[] }>;

export const aiConfigured = () => Boolean(process.env.AI_API_KEY?.trim() && process.env.AI_BASE_URL?.trim() && process.env.AI_MODEL?.trim());

export const complete: Complete = async (messages, tools) => {
  if (!aiConfigured()) throw new AiOffError("AI isn't configured: add AI_BASE_URL, AI_API_KEY and AI_MODEL to .env.");
  const base = process.env.AI_BASE_URL!.trim().replace(/\/?$/, "/");
  const res = await fetch(`${base}chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AI_API_KEY!.trim()}` },
    // tool_choice is only valid alongside tools; a call with no tools sends neither.
    body: JSON.stringify({ model: process.env.AI_MODEL!.trim(), messages, ...(tools.length ? { tools, tool_choice: "auto" } : {}) }),
  });
  if (res.status === 429) throw new AiLimitError("The AI provider's rate limit was reached.");
  if (!res.ok) throw new Error(`AI request failed (${res.status})`);
  const json = (await res.json()) as { choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[] };
  const msg = json.choices?.[0]?.message;
  if (!msg) throw new Error("The AI provider returned no message.");
  return { content: msg.content ?? null, tool_calls: msg.tool_calls?.length ? msg.tool_calls : undefined };
};
