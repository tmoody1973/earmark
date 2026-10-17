// One-off probe (M5-T2): does the AI Gateway forward an image `state` to a Decisions model?
// Run: pnpm exec tsx --env-file=.env.local scripts/probe-photo-decisions.ts [model]
import { experimental_decide as decide } from "ai";

// Fantastic Mr Fox cover from Open Library (public, no person in it)
const res = await fetch("https://covers.openlibrary.org/b/isbn/9780140328721-L.jpg");
const bytes = new Uint8Array(await res.arrayBuffer());
const model = process.argv[2] ?? "openai/gpt-6-luna-decisions";
const result = await decide({
  model,
  state: [{ type: "file", mediaType: "image/jpeg", data: bytes }],
  questions: { isBook: { type: "boolean", instructions: "Does the image show the cover of a book?" } },
});
console.log(JSON.stringify({ model, p: result.answers.isBook.probability, warnings: result.warnings }));
