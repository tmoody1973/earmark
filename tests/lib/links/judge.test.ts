import { describe, expect, it, vi } from "vitest";
import { FITS, RELATED, SAME_IDEA } from "../../../agent/lib/links/criteria";
import { ideaText, judgeIdeaPair, judgeRecFit } from "../../../agent/lib/links/judge";

// Synthetic examples only: no real transcript text in code or tests.
describe("judge", () => {
  it("builds short state text: title, summary, then the timeline notes without their dates", () => {
    expect(ideaText({ title: "Station crates", summary: "Hosts share weekly picks", notes: [] })).toBe("Station crates. Hosts share weekly picks");
    expect(ideaText({ title: "Station crates", summary: null, notes: ["Oct 6: first heard", "Oct 9: added a guest host"] }))
      .toBe("Station crates. Notes: first heard; added a guest host");
  });

  it("clips the state to 80 words: Jev reads short state best", () => {
    const long = Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ");
    expect(ideaText({ title: "T", summary: long, notes: [] }).split(" ")).toHaveLength(80);
  });

  it("asks related + same_idea about one pair in one call", async () => {
    const ask = vi.fn(async () => ({ related: 0.8, same_idea: 0.2 }));
    const r = await judgeIdeaPair({ title: "A", summary: null, notes: [] }, { title: "B", summary: null, notes: [] }, ask as never);
    expect(r).toEqual({ related: 0.8, sameIdea: 0.2 });
    expect(ask).toHaveBeenCalledWith({ idea_a: "A", idea_b: "B" }, { related: RELATED, same_idea: SAME_IDEA });
  });

  it("asks fits for a rec against an idea", async () => {
    const ask = vi.fn(async () => ({ fits: 0.75 }));
    const r = await judgeRecFit(
      { type: "book", name: "A synthetic book", creator: null, contextSummary: null },
      { title: "Garden show", summary: null, notes: [] },
      ask as never,
    );
    expect(r).toEqual({ fits: 0.75 });
    expect(ask).toHaveBeenCalledWith({ rec: "book: A synthetic book", idea: "Garden show" }, { fits: FITS });
  });

  it("every question names the state fields it reads and states both sides with a boundary case", () => {
    for (const q of [RELATED, SAME_IDEA]) {
      expect(q.instructions).toContain("`idea_a`");
      expect(q.instructions).toContain("`idea_b`");
    }
    expect(FITS.instructions).toContain("`rec`");
    expect(FITS.instructions).toContain("`idea`");
    for (const q of [RELATED, SAME_IDEA, FITS]) {
      expect(q.whenTrue.length).toBeGreaterThan(40);
      expect(q.whenFalse).toMatch(/even (if|when)/i); // the boundary case: a shared broad topic is not enough
    }
  });
});
