import { ask } from "@/lib/analyst/analyst";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The AI analyst: one question in, a checked answer out (with the metrics it used and links to their views).
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { question?: unknown };
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return Response.json({ error: "Ask a question." }, { status: 400 });
  if (question.length > 500) return Response.json({ error: "Keep the question under 500 characters." }, { status: 400 });
  return Response.json(await ask(question));
}
