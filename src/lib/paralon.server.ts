// Server-only helpers for the Paralon Cloud free model.

const BASE_URL = "https://paraloncloud.com/v1/chat/completions";
export const MODEL = "qwen3.8-27b";

export function getKeys(): string[] {
  const keys = [
    process.env["PARALON_API_KEY_1"],
    process.env["PARALON_API_KEY_2"],
    process.env["PARALON_API_KEY_3"],
    process.env["PARALON_API_KEY_4"],
  ].filter((k): k is string => typeof k === "string" && k.length > 0);
  if (keys.length === 0) throw new Error("Paralon API keys missing");
  return keys;
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function chat(opts: {
  messages: ChatMessage[];
  keyIndex?: number;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<string> {

  const keys = getKeys();
  const start = Math.abs(opts.keyIndex ?? 0) % keys.length;
  let lastError = "";

  for (let attempt = 0; attempt < keys.length * 2; attempt++) {
    const key = keys[(start + attempt) % keys.length]!;
    try {
      const res = await fetch(BASE_URL, {
        method: "POST",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 240000),
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          messages: opts.messages,
          max_tokens: opts.maxTokens ?? 6000,
          temperature: opts.temperature ?? 0.9,
        }),
      });


      if (!res.ok) {
        lastError = `${res.status} ${(await res.text()).slice(0, 300)}`;
        if (res.status === 429 || res.status >= 500) {
          await new Promise((r) => setTimeout(r, 1200 + attempt * 800));
          continue;
        }
        throw new Error(lastError);
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content ?? "";
      if (!content.trim()) {
        lastError = "empty response";
        continue;
      }
      return content;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw new Error("AI request failed: " + lastError);
}

const DEVANAGARI_DIGITS = /[\u0966-\u096F]/g;

// Enforces rule eight: no symbols, emoji, numbers or stars anywhere in a story.
export function sanitizeStoryText(raw: string): string {
  let text = raw;
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  text = text.replace(/```[\s\S]*?```/g, "");
  text = text.replace(DEVANAGARI_DIGITS, "");
  text = text.replace(/[0-9]/g, "");
  text = text.replace(/[A-Za-z]/g, "");
  // strip emoji and pictographs
  text = text.replace(
    /[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\u{FE00}-\u{FE0F}\u{2600}-\u{27BF}\u{200D}]/gu,
    "",
  );
  text = text.replace(/[*#_`~^<>{}\[\]|\\/@$%&+=•·◆■□●○★☆✦→←↔$"'"'«»]/g, "");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/ ?([।,?!:;]) ?/g, "$1 ");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  return text.trim();
}
