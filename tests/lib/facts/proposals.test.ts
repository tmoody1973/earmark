import { beforeEach, describe, expect, it, vi } from "vitest";

const sql = vi.fn();
vi.mock("../../../agent/lib/db", () => ({ db: () => sql }));
vi.mock("../../../agent/lib/env", () => ({ getEnv: () => ({ TRIAGE_MODEL: "triage", WRITE_MODEL: "write" }) }));
import { proposeIdeaFacts, proposeTasteFacts, writePendingProposals } from "../../../agent/lib/facts/proposals";

const loved = [
  { id: 1, type: "album", canonical_name: "Promises", creator: "Floating Points" },
  { id: 2, type: "album", canonical_name: "Kind of Blue", creator: "Miles Davis" },
  { id: 3, type: "album", canonical_name: "A Love Supreme", creator: "John Coltrane" },
  { id: 4, type: "place", canonical_name: "Ramen Kyuu", creator: null },
];

const q = (i: number) => (sql.mock.calls[i][0] as TemplateStringsArray).join("?");
beforeEach(() => sql.mockReset());

describe("proposeTasteFacts", () => {
  it("keeps a statement only when code counts 3+ fitting items and Jev says it is only about the user", async () => {
    sql
      .mockResolvedValueOnce(loved) // loved recs
      .mockResolvedValueOnce([{ first_name: "Ann" }]) // recommender names
      .mockResolvedValueOnce([]) // existing proposals
      .mockResolvedValueOnce([{ id: 10 }]); // insert
    const generateImpl = vi.fn(async () => ({ output: { statements: ["Loves spiritual jazz", "Enjoys late-night ramen", "Loves Ann's taste in ramen"] } }));
    const decideImpl = vi.fn(async (opts: { questions: Record<string, unknown>; state: { taste?: string; statement?: string } }) => {
      if ("about_user" in opts.questions) return { answers: { about_user: { type: "boolean", probability: 0.95 } } };
      const keys = Object.keys(opts.questions);
      expect(keys.every((k) => /^fits_i_\d+$/.test(k))).toBe(true);
      const jazz = opts.state.taste === "Loves spiritual jazz";
      return { answers: Object.fromEntries(keys.map((k) => [k, { type: "boolean", probability: jazz && k !== "fits_i_4" ? 0.9 : 0.1 }])) };
    });
    const out = await proposeTasteFacts({ generateImpl: generateImpl as never, decideImpl: decideImpl as never });
    expect(out).toEqual(["Loves spiritual jazz"]);
    expect(sql).toHaveBeenCalledTimes(4);
    expect(q(3)).toContain("insert into fact_proposals");
    expect(sql.mock.calls[3].slice(1)).toEqual(["Loves spiritual jazz", "[1,2,3]"]);
    // The statement that names a recommender never reaches Jev.
    expect(decideImpl.mock.calls.map(([o]) => o.state.taste ?? o.state.statement)).not.toContain("Loves Ann's taste in ramen");
  });

  it("drops a statement Jev does not judge to be only about the user", async () => {
    sql.mockResolvedValueOnce(loved).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const generateImpl = vi.fn(async () => ({ output: { statements: ["Loves what friends play"] } }));
    const decideImpl = vi.fn(async (opts: { questions: Record<string, unknown> }) =>
      "about_user" in opts.questions
        ? { answers: { about_user: { type: "boolean", probability: 0.3 } } }
        : { answers: Object.fromEntries(Object.keys(opts.questions).map((k) => [k, { type: "boolean", probability: 0.9 }])) });
    expect(await proposeTasteFacts({ generateImpl: generateImpl as never, decideImpl: decideImpl as never })).toEqual([]);
    expect(sql).toHaveBeenCalledTimes(3);
  });

  it("skips a statement already proposed", async () => {
    sql.mockResolvedValueOnce(loved).mockResolvedValueOnce([]).mockResolvedValueOnce([{ t: "loves spiritual jazz" }]);
    const generateImpl = vi.fn(async () => ({ output: { statements: ["Loves Spiritual Jazz"] } }));
    const decideImpl = vi.fn();
    expect(await proposeTasteFacts({ generateImpl: generateImpl as never, decideImpl: decideImpl as never })).toEqual([]);
    expect(decideImpl).not.toHaveBeenCalled();
  });

  it("does nothing with fewer than 3 loved recs", async () => {
    sql.mockResolvedValueOnce(loved.slice(0, 2));
    const generateImpl = vi.fn();
    expect(await proposeTasteFacts({ generateImpl: generateImpl as never, decideImpl: vi.fn() as never })).toEqual([]);
    expect(generateImpl).not.toHaveBeenCalled();
  });
});

describe("proposeIdeaFacts", () => {
  it("builds the text in code from the cluster's count and first date", async () => {
    sql.mockResolvedValueOnce([{ id: 12, title: "A CRM for public radio", mention_count: 4, first_mentioned_at: "2026-09-10T15:00:00Z" }]).mockResolvedValue([]);
    expect(await proposeIdeaFacts()).toBe(1);
    expect(sql.mock.calls[1].slice(1)).toEqual(["Developing an idea: A CRM for public radio (mentioned 4 times since Sep)", "[12]"]);
  });
});

describe("writePendingProposals", () => {
  it("creates an unconfirmed Bee fact per pending proposal and records the id", async () => {
    sql.mockResolvedValueOnce([{ id: 5, text: "Loves spiritual jazz" }]).mockResolvedValue([]);
    const createFact = vi.fn(async () => ({ id: 77, text: "Loves spiritual jazz", confirmed: false }));
    expect(await writePendingProposals({ createFact } as never)).toBe(1);
    expect(createFact).toHaveBeenCalledWith("Loves spiritual jazz");
    expect(q(1)).toContain("update fact_proposals set bee_fact_id");
    expect(sql.mock.calls[1].slice(1)).toEqual([77, 5]);
    expect(q(2)).toContain("insert into bee_sync");
  });
});
