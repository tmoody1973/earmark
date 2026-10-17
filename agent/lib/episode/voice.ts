import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import { getEnv } from "../env";

// Polly SynthesizeSpeech: 6000 chars per call, 3000 billed; plain text, so stay under 3000.
export function chunkForPolly(text: string, max = 2900): string[] {
  const sentences = text
    .split(/\n{2,}/)
    .flatMap((p) => p.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [p])
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > max) {
      if (current) { chunks.push(current); current = ""; }
      for (let i = 0; i < sentence.length; i += max) chunks.push(sentence.slice(i, i + max));
      continue;
    }
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > max) { chunks.push(current); current = sentence; } else current = next;
  }
  if (current) chunks.push(current);
  return chunks;
}

// Credentials are passed explicitly (EARMARK_AWS_*): Vercel may reserve the plain AWS_* names on Functions.
export function makePollyClient(env = getEnv()): PollyClient {
  const accessKeyId = env.EARMARK_AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.EARMARK_AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) throw new Error("Polly credentials are not set (EARMARK_AWS_ACCESS_KEY_ID / EARMARK_AWS_SECRET_ACCESS_KEY)");
  return new PollyClient({ region: env.EARMARK_AWS_REGION, credentials: { accessKeyId, secretAccessKey } });
}

// Per chunk: a 1100-word script is ~3 chunks, so ~75 s worst case, which with script.ts fits the 5-minute claim lease.
const POLLY_TIMEOUT_MS = 25_000;

export async function synthesize(
  chunks: string[],
  client: Pick<PollyClient, "send"> = makePollyClient(),
  voice: string = getEnv().POLLY_VOICE,
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for (const Text of chunks) {
    const res = await client.send(
      new SynthesizeSpeechCommand({ Engine: "generative", OutputFormat: "mp3", VoiceId: voice as never, Text, TextType: "text" }),
      { abortSignal: AbortSignal.timeout(POLLY_TIMEOUT_MS) },
    );
    if (!res.AudioStream) throw new Error("Polly returned no audio");
    parts.push(await res.AudioStream.transformToByteArray());
  }
  // MP3 frames concatenate cleanly; players treat the result as one file.
  return Uint8Array.from(Buffer.concat(parts));
}
