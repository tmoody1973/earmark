import { describe, expect, it } from "vitest";
import { recEmbedText } from "../../../agent/lib/recs/embed-text";

// The one recipe for a tip's text (decision 026): what recommendations.embedding is made from, and what Jev reads.
describe("recEmbedText", () => {
  it("is the type, name, creator and context summary: never the excerpt or raw text", () => {
    expect(recEmbedText({ type: "album", name: "Promises", creator: "Floating Points", contextSummary: null }))
      .toBe("album: Promises by Floating Points");
    expect(recEmbedText({ type: "film_tv", name: "A film", creator: null, contextSummary: "Watch it for the score." }))
      .toBe("film or TV: A film. Watch it for the score.");
  });

  it("clips to 80 words", () => {
    const long = Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ");
    expect(recEmbedText({ type: "book", name: "B", creator: null, contextSummary: long }).split(" ")).toHaveLength(80);
  });
});
