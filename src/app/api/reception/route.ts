import { NextResponse, type NextRequest } from "next/server";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { fallbackReceptionAnswer, receptionistPolicy } from "@/lib/reception/guide";

const RequestSchema = z.object({
  messages: z.array(z.unknown()).min(1).max(24),
  pathname: z.string().startsWith("/").max(240).optional(),
});

const windows = new Map<string, { count: number; resetsAt: number }>();

function questionFrom(messages: UIMessage[]): string | null {
  const message = [...messages].reverse().find((item) => item.role === "user");
  const text = message?.parts
    .filter((part): part is Extract<(typeof message.parts)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
  return text && text.length <= 1200 ? text : null;
}

function limited(req: NextRequest): boolean {
  const key = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "anonymous";
  const now = Date.now();
  const current = windows.get(key);
  if (!current || current.resetsAt <= now) {
    windows.set(key, { count: 1, resetsAt: now + 60_000 });
    return false;
  }
  current.count += 1;
  return current.count > 8;
}

function deterministic(answer: string): Response {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: "start" });
      writer.write({ type: "start-step" });
      writer.write({ type: "text-start", id: "answer" });
      writer.write({ type: "text-delta", id: "answer", delta: answer });
      writer.write({ type: "text-end", id: "answer" });
      writer.write({ type: "finish-step" });
      writer.write({ type: "finish" });
    },
  });
  return createUIMessageStreamResponse({ stream });
}

export async function POST(req: NextRequest) {
  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const messages = body.messages as UIMessage[];
  const question = questionFrom(messages);
  if (!question) return NextResponse.json({ error: "invalid_message" }, { status: 422 });
  if (limited(req)) return deterministic("The public chat limit was reached for this minute. Please wait and try again, or email support@billguarded.com.");

  if (!(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN)) {
    return deterministic(fallbackReceptionAnswer(question));
  }

  try {
    const result = streamText({
      model: "openai/gpt-5-mini",
      instructions: `${receptionistPolicy()}\n\nCurrent public page: ${body.pathname ?? "/"}`,
      messages: await convertToModelMessages(messages.slice(-12)),
      maxOutputTokens: 600,
    });
    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream, originalMessages: messages }),
    });
  } catch {
    return deterministic(fallbackReceptionAnswer(question));
  }
}
