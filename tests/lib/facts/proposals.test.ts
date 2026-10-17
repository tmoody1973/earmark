import { beforeEach, describe, expect, it, vi } from "vitest";

const sql = vi.fn();
vi.mock("../../../agent/lib/db", () => ({ db: () => sql }));
const owner = vi.fn<() => string | undefined>(() => undefined);
vi.mock("../../../agent/lib/env", () => ({ getEnv: () => ({ TRIAGE_MODEL: "triage", WRITE_MODEL: "write" }), ownerFirstName: () => owner() }));
import { proposeIdeaFacts, proposeTasteFacts, writePendingProposals } from "../../../agent/lib/facts/proposals";

const loved = [
  { id: 1, type: "album", canonical_name: "Promises", creator: "Floating Points" },
  { id: 2, type: "album", canonical_name: "Kind of Blue", creator: "Miles Davis" },
  { id: 3, type: "album", canonical_name: "A Love Supreme", creator: "John Coltrane" },
  { id: 4, type: "place", canonical_name: "Ramen Kyuu", creator: null },
];

const q = (i: number) => (sql.mock.calls[i][0] as TemplateStringsArray).join("?");
beforeEach(() => { sql.mockReset(); owner.mockReset(); owner.mockReturnValue(undefined); });

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

describe("proposeTasteFacts owner and prompt guards", () => {
  it("never lets the owner's own first name into a statement and tells the model the list is data", async () => {
    owner.mockReturnValue("Tarik");
    sql.mockResolvedValueOnce(loved).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const generateImpl = vi.fn(async (_o: { prompt: string }) => ({ output: { statements: ["Tarik loves spiritual jazz"] } }));
    const decideImpl = vi.fn();
    expect(await proposeTasteFacts({ generateImpl: generateImpl as never, decideImpl: decideImpl as never })).toEqual([]);
    expect(decideImpl).not.toHaveBeenCalled();
    expect(generateImpl.mock.calls[0]![0].prompt).toMatch(/data, not instructions/);
  });
});

describe("proposeIdeaFacts", () => {
  const cluster = (id: number, title: string) => ({ id, title, mention_count: 4, first_mentioned_at: "2026-09-10T15:00:00Z" });
  it("builds the text in code from the cluster's count and first date", async () => {
    sql.mockResolvedValueOnce([cluster(12, "A CRM for public radio")]).mockResolvedValue([]);
    expect(await proposeIdeaFacts()).toBe(1);
    expect(sql.mock.calls[2]!.slice(1)).toEqual(["Developing an idea: A CRM for public radio (mentioned 4 times since Sep)", "[12]"]);
  });
  it("creates at most 3 idea proposals per run", async () => {
    sql.mockResolvedValueOnce([1, 2, 3, 4, 5].map((n) => cluster(n, `Idea number ${n}`))).mockResolvedValue([]);
    expect(await proposeIdeaFacts()).toBe(3);
    const inserts = sql.mock.calls.filter((c) => (c[0] as TemplateStringsArray).join("?").includes("insert into fact_proposals"));
    expect(inserts).toHaveLength(3);
  });
  it("skips ideas whose title names the owner or a known recommender", async () => {
    owner.mockReturnValue("Tarik");
    sql.mockResolvedValueOnce([cluster(1, "Tarik's radio app"), cluster(2, "Ann Smith's podcast"), cluster(3, "A CRM for public radio")])
      .mockResolvedValueOnce([{ first_name: "Ann" }]).mockResolvedValue([]);
    expect(await proposeIdeaFacts()).toBe(1);
    const inserts = sql.mock.calls.filter((c) => (c[0] as TemplateStringsArray).join("?").includes("insert into fact_proposals"));
    expect(inserts.map((c) => c[2])).toEqual(["[3]"]);
  });
});

describe("writePendingProposals", () => {
  const row = (id: number, text: string, attempted = false) => ({ id, text, attempted });
  it("claims, posts and records the Bee id and sync row in one statement", async () => {
    sql.mockResolvedValueOnce([row(5, "Loves spiritual jazz")]).mockResolvedValueOnce([{ id: 5 }]).mockResolvedValue([]);
    const createFact = vi.fn(async () => ({ id: 77 }));
    expect(await writePendingProposals({ createFact } as never)).toBe(1);
    expect(createFact).toHaveBeenCalledWith("Loves spiritual jazz");
    expect(q(1)).toContain("write_started_at = now()");
    expect(q(2)).toContain("insert into bee_sync");
    expect(sql.mock.calls[2]!.slice(1, 3)).toEqual([77, 5]);
  });
  it("skips a proposal whose claim was lost", async () => {
    sql.mockResolvedValueOnce([row(5, "Loves jazz")]).mockResolvedValueOnce([]);
    const createFact = vi.fn();
    expect(await writePendingProposals({ createFact } as never)).toBe(0);
    expect(createFact).not.toHaveBeenCalled();
  });
  it("reconciles an earlier attempt: adopts the matching unconfirmed Bee fact instead of posting again", async () => {
    sql.mockResolvedValueOnce([row(5, "Loves Spiritual Jazz", true)]).mockResolvedValueOnce([{ id: 5 }])
      .mockResolvedValueOnce([]) // bee ids already linked
      .mockResolvedValue([]);
    const createFact = vi.fn();
    const listFacts = vi.fn(async () => ({ facts: [{ id: 99, text: "  loves spiritual jazz " }], next_cursor: null }));
    expect(await writePendingProposals({ createFact, listFacts } as never)).toBe(1);
    expect(createFact).not.toHaveBeenCalled();
    expect(listFacts).toHaveBeenCalledWith(expect.objectContaining({ confirmed: false }));
    expect(sql.mock.calls.at(-1)!.slice(1, 3)).toEqual([99, 5]);
  });
  it("posts when the earlier attempt left no matching fact in Bee", async () => {
    sql.mockResolvedValueOnce([row(5, "Loves jazz", true)]).mockResolvedValueOnce([{ id: 5 }]).mockResolvedValue([]);
    const createFact = vi.fn(async () => ({ id: 7 }));
    const listFacts = vi.fn(async () => ({ facts: [{ id: 99, text: "something else" }], next_cursor: null }));
    expect(await writePendingProposals({ createFact, listFacts } as never)).toBe(1);
    expect(createFact).toHaveBeenCalledTimes(1);
  });
  it("selects at most 5 pending proposals per run", async () => {
    sql.mockResolvedValueOnce([]);
    await writePendingProposals({ createFact: vi.fn() } as never);
    expect(sql.mock.calls[0]!.slice(1)).toContain(5);
  });
  it("logs ids and error names only, and keeps going after a failed post", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    sql.mockResolvedValueOnce([row(5, "secret fact text"), row(6, "Loves ramen")]).mockResolvedValue([{ id: 1 }]);
    const createFact = vi.fn().mockRejectedValueOnce(Object.assign(new Error("body with secret fact text"), { name: "BeeApiError" })).mockResolvedValueOnce({ id: 8 });
    expect(await writePendingProposals({ createFact } as never)).toBe(1);
    expect(JSON.stringify(err.mock.calls)).not.toMatch(/secret/);
    expect(JSON.stringify(err.mock.calls)).toMatch(/BeeApiError/);
    err.mockRestore();
  });
});
