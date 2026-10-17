import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RecExtraction } from "../../agent/lib/types";

// M5-T13 (MOO-923), real Neon `test` branch (TEST_DATABASE_URL, never production): the real claim, save and finish SQL
// behind handleInboundEmail. Resend, the triage model and the extractor are fakes. Names and addresses are made up.
const RUN = String(Date.now() % 1_000_000);
const ID = (n: string) => `inttest-${RUN}-${n}`;
const OWNER_EMAIL = "owner-int@example.org";
const OWNER = "Odette";
const FRIEND = "Zzemailann";
const TITLE = `Zzemail Promises ${RUN}`;

const forward = (sender: string) => `Have you heard this?

---------- Forwarded message ---------
From: ${sender} Smith <friend@example.com>
Subject: you need this album

Listen to ${TITLE} by Floating Points. https://example.com/album`;

const req = (emailId: string) =>
  new Request("https://earmark.test/api/email/inbound", {
    method: "POST",
    headers: { "svix-id": "1", "svix-timestamp": "1", "svix-signature": "v1,x" },
    body: JSON.stringify({ type: "email.received", data: { email_id: emailId } }),
  });

const TRIAGE = { kind: "rec_to_user", kindProbability: 0.9, recType: "album", recTypeProbability: 0.9, jokingProbability: 0.01, broadcastProbability: 0, model: "m", providerMetadata: null };

describe.skipIf(!process.env.TEST_DATABASE_URL)("email-in (real Neon)", () => {
  const prev: Record<string, string | undefined> = {};
  const afterCreated = vi.fn();
  const fakes = (over: { from?: string; text?: string; triage?: object; ext?: Partial<RecExtraction> } = {}) => ({
    verify: (raw: string) => JSON.parse(raw),
    fetchEmail: vi.fn(async () => ({
      from: over.from ?? `Owner <${OWNER_EMAIL}>`, subject: "Fwd: you need this album", text: over.text ?? forward(FRIEND), html: null,
      headers: null, created_at: "2030-03-01T19:00:00Z",
    })),
    triage: vi.fn(async () => ({ ...TRIAGE, ...over.triage })) as never,
    extract: vi.fn(async (): Promise<RecExtraction> => ({ canonicalName: TITLE, creator: "Floating Points", recommenderName: null, excerpt: `Listen to ${TITLE} by Floating Points.`, ...over.ext })),
    afterCreated,
  });
  const handle = async (emailId: string, over?: Parameters<typeof fakes>[0]) => {
    const { handleInboundEmail } = await import("../../agent/lib/capture/email");
    const d = fakes(over);
    return { res: await handleInboundEmail(req(emailId), d), d };
  };
  const rows = async (title = TITLE) => {
    const { db } = await import("../../agent/lib/db");
    return db()`select r.id, r.source, r.status, r.attribution_source, r.bee_conversation_id, r.confidence, rc.first_name
                from recommendations r left join recommenders rc on rc.id = r.recommender_id
                where r.canonical_name = ${title} order by r.id`;
  };

  beforeAll(() => {
    for (const k of ["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "EARMARK_OWNER_EMAIL", "EARMARK_OWNER_FIRST_NAME"]) prev[k] = process.env[k];
    process.env.RESEND_API_KEY = "re_int";
    process.env.RESEND_WEBHOOK_SECRET = "whsec_int";
    process.env.EARMARK_OWNER_EMAIL = OWNER_EMAIL;
    process.env.EARMARK_OWNER_FIRST_NAME = OWNER;
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const { db } = await import("../../agent/lib/db");
    const sql = db();
    await sql`delete from processed_emails where email_id like ${`inttest-${RUN}-%`}`;
    await sql`delete from recommendations where canonical_name like ${`Zzemail %${RUN}`}`;
    await sql`delete from recommenders where first_name_key = any(${[FRIEND.toLowerCase(), OWNER.toLowerCase()]})
              and not exists (select 1 from recommendations x where x.recommender_id = recommenders.id)`;
  });

  it("saves one email rec, credits the friend, never the owner", async () => {
    const { res } = await handle(ID("a"));
    expect(res.status).toBe(201);
    const found = await rows();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ source: "email", status: "new", attribution_source: "email", first_name: FRIEND, bee_conversation_id: null });
    expect(Number(found[0]!.confidence)).toBeCloseTo(0.9);
    const { db } = await import("../../agent/lib/db");
    const [claim] = await db()`select outcome, recommendation_id, processed_at from processed_emails where email_id = ${ID("a")}`;
    expect(claim).toMatchObject({ outcome: "saved" });
    expect(Number(claim!.recommendation_id)).toBe(Number(found[0]!.id));
    expect(claim!.processed_at).not.toBeNull();
    const [owner] = await db()`select count(*)::int as n from recommenders where first_name_key = ${OWNER.toLowerCase()}`;
    expect(owner!.n).toBe(0);
  });

  it("a retried delivery of the same email id saves nothing new", async () => {
    const before = (await rows()).length;
    const { res, d } = await handle(ID("a"));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("duplicate");
    expect(d.fetchEmail).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(before);
  });

  it("two simultaneous deliveries save once", async () => {
    const title = `Zzemail Race ${RUN}`;
    const make = () => {
      return fakes({ ext: { canonicalName: title, creator: null, excerpt: "race" } });
    };
    const { handleInboundEmail } = await import("../../agent/lib/capture/email");
    const [x, y] = await Promise.all([handleInboundEmail(req(ID("race")), make()), handleInboundEmail(req(ID("race")), make())]);
    expect([x.status, y.status].sort()).toEqual([200, 201]);
    expect(await rows(title)).toHaveLength(1);
  });

  it("a failed run releases its claim so the retry can save", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
    const { handleInboundEmail } = await import("../../agent/lib/capture/email");
    const title = `Zzemail Retry ${RUN}`;
    const d = { ...fakes(), extract: vi.fn(async (): Promise<RecExtraction> => { throw new Error("model down"); }) };
    expect((await handleInboundEmail(req(ID("retry")), d)).status).toBe(500);
    const { db } = await import("../../agent/lib/db");
    expect(await db()`select 1 from processed_emails where email_id = ${ID("retry")}`).toHaveLength(0);
    const ok = fakes({ ext: { canonicalName: title, creator: null, excerpt: "retry" } });
    expect((await handleInboundEmail(req(ID("retry")), ok)).status).toBe(201);
    expect(await rows(title)).toHaveLength(1);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("a non-owner sender saves nothing", async () => {
    const before = (await rows()).length;
    const { res, d } = await handle(ID("spam"), { from: "Someone <someone@example.net>" });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ignored");
    expect(d.triage).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(before);
    const { db } = await import("../../agent/lib/db");
    const [claim] = await db()`select outcome, recommendation_id from processed_emails where email_id = ${ID("spam")}`;
    expect(claim).toMatchObject({ outcome: "ignored", recommendation_id: null });
  });

  it("a non-recommendation triage result is saved as needs_review", async () => {
    const title = `Zzemail Doubt ${RUN}`;
    const { handleInboundEmail } = await import("../../agent/lib/capture/email");
    const d = fakes({ triage: { kind: "neither", kindProbability: 0.8 }, ext: { canonicalName: title, creator: null, excerpt: "maybe" } });
    expect((await handleInboundEmail(req(ID("doubt")), d)).status).toBe(201);
    const found = await rows(title);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ source: "email", status: "needs_review" });
  });

  it("a forward whose original sender is the owner credits no one", async () => {
    const title = `Zzemail Self ${RUN}`;
    const { handleInboundEmail } = await import("../../agent/lib/capture/email");
    const d = fakes({ text: forward(OWNER), ext: { canonicalName: title, creator: null, recommenderName: OWNER, excerpt: "self" } });
    expect((await handleInboundEmail(req(ID("self")), d)).status).toBe(201);
    expect((await rows(title))[0]).toMatchObject({ first_name: null, attribution_source: "none" });
  });
});
