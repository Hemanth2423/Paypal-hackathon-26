import { readSyncSummary, syncFromBraintree } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Last successful sync, so the Connect screen can show its summary after a reload.
export async function GET() {
  return Response.json({ summary: readSyncSummary() });
}

// Syncs from Braintree and streams progress as newline-delimited JSON events.
export async function POST() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      await syncFromBraintree((event) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
