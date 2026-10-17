import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addressOf, forwardedSenderName, handleInboundEmail, hasAuthFailure } from "../../../agent/lib/capture/email";

const GMAIL_FORWARD = `Have you heard this?

---------- Forwarded message ---------
From: Ann Smith <ann@example.com>
Date: Sat, Oct 17, 2026 at 9:12 PM
Subject: you need this album

Listen to Promises by Floating Points. https://music.apple.com/us/album/promises/1550583154`;

const KEYS = ["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "EARMARK_OWNER_EMAIL", "EARMARK_OWNER_FIRST_NAME"] as const;
beforeEach(() => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.RESEND_WEBHOOK_SECRET = "whsec_test";
  process.env.EARMARK_OWNER_EMAIL = "owner@example.org";
  process.env.EARMARK_OWNER_FIRST_NAME = "Tarik";
});
afterEach(() => {
  for (const k of KEYS) delete process.env[k];
  vi.restoreAllMocks();
});

describe("parsers", () => {
  it("finds the original sender in a Gmail-style forward", () => {
    expect(forwardedSenderName(GMAIL_FORWARD)).toBe("Ann Smith");
  });
  it("returns null when there is no forwarded header", () => {
    expect(forwardedSenderName("just a note to self")).toBeNull();
  });
  it("extracts the bare address", () => {
    expect(addressOf("Tarik Moody <Owner@Example.org>")).toBe("owner@example.org");
    expect(addressOf("owner@example.org")).toBe("owner@example.org");
  });
  it("rejects an address smuggled into a quoted display name", () => {
    expect(addressOf('"owner@example.org <owner@example.org>" <attacker@evil.test>')).toBeNull();
    expect(addressOf('"Tarik <owner@example.org>" <attacker@evil.test>')).toBeNull();
  });
  it("accepts only plain sender lines", () => {
    for (const from of ["Tarik Moody <owner@example.org>", '"Tarik Moody" <owner@example.org>', "owner@example.org", "OWNER@Example.org", "Tárik Moody <owner@example.org>", "<owner@example.org>", "  Tarik <owner@example.org>\r\n"]) {
      expect(addressOf(from), from).toBe("owner@example.org");
    }
  });
  it("rejects every known parser-confusion bypass", () => {
    for (const from of [
      "attacker@evil.test <owner@example.org>",
      "attacker@evil.test<owner@example.org>",
      '(") <attacker@evil.test> (") <owner@example.org>',
      '\\"<attacker@evil.test>,"<owner@example.org>',
      "Tarik (owner@example.org) <attacker@evil.test>",
      "=?utf-8?q?Tarik?= <owner@example.org>",
      "Group: owner@example.org;",
      "Tarik <owner@example.org> (comment)",
      "owner@example.org.",
      ".owner@example.org",
      "owner@example",
      "owner@@example.org",
    ]) {
      expect(addressOf(from), from).toBeNull();
    }
  });
  it("rejects a From that is not exactly one mailbox", () => {
    expect(addressOf("Ann <ann@example.com>, Tarik <owner@example.org>")).toBeNull();
    expect(addressOf("owner@example.org, ann@example.com")).toBeNull();
    expect(addressOf("Tarik <owner@example.org")).toBeNull();
    expect(addressOf("<<owner@example.org>>")).toBeNull();
    expect(addressOf("not an address")).toBeNull();
  });
  it("flags an explicit SPF, DKIM or DMARC failure and nothing else", () => {
    expect(hasAuthFailure({ "Authentication-Results": "mx.example; spf=fail smtp.mailfrom=x; dkim=pass" })).toBe(true);
    expect(hasAuthFailure({ "authentication-results": "mx; dmarc=fail (p=none)" })).toBe(true);
    expect(hasAuthFailure({ "Received-SPF": "Fail (domain does not designate)" })).toBe(true);
    expect(hasAuthFailure({ "Authentication-Results": "mx; spf=pass; dkim=pass; dmarc=pass" })).toBe(false);
    expect(hasAuthFailure({ Subject: "spf=fail in the subject is not a header result" })).toBe(false);
    expect(hasAuthFailure(null)).toBe(false);
  });
});

const req = (body = '{"type":"email.received","data":{"email_id":"e1"}}') =>
  new Request("https://earmark.test/api/email/inbound", { method: "POST", headers: { "svix-id": "1", "svix-timestamp": "1", "svix-signature": "v1,x" }, body });

const EMAIL = { from: "Tarik Moody <owner@example.org>", subject: "Fwd: you need this album", text: GMAIL_FORWARD, html: null, headers: null as Record<string, string> | null, created_at: "2026-10-18T02:00:00Z" };
const REC_TRIAGE = { kind: "rec_to_user", kindProbability: 0.9, recType: "album", recTypeProbability: 0.9, jokingProbability: 0.02, broadcastProbability: 0, model: "m", providerMetadata: null };

function deps(over: Record<string, unknown> = {}) {
  return {
    verify: vi.fn((raw: string) => JSON.parse(raw)),
    claim: vi.fn(async () => true),
    release: vi.fn(async () => undefined),
    finish: vi.fn(async () => undefined),
    fetchEmail: vi.fn(async () => EMAIL),
    triage: vi.fn(async () => REC_TRIAGE),
    extract: vi.fn(async (_i?: { text: string; summary: string | null }) => ({ canonicalName: "Promises", creator: "Floating Points", recommenderName: null, excerpt: "Listen to Promises by Floating Points." })),
    save: vi.fn(async (_rec: Record<string, any>) => ({ id: 61, upgraded: false })), // eslint-disable-line @typescript-eslint/no-explicit-any
    afterCreated: vi.fn((_id: number) => undefined),
    ...over,
  };
}
const json = async (r: Response) => r.json();

describe("handleInboundEmail", () => {
  it("401 on a bad signature, before touching the database", async () => {
    const d = deps({ verify: vi.fn(() => { throw new Error("bad sig"); }) });
    expect((await handleInboundEmail(req(), d as never)).status).toBe(401);
    expect(d.claim).not.toHaveBeenCalled();
  });
  it.each(KEYS.slice(0, 3))("fails closed when %s is missing, naming only the key in the log", async (key) => {
    delete process.env[key];
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const d = deps();
    const res = await handleInboundEmail(req(), d as never);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(d.verify).not.toHaveBeenCalled();
    expect(String(log.mock.calls[0]?.[0])).toContain(key);
  });
  it("treats the quoted-display-name attack and a two-mailbox From as non-owner", async () => {
    for (const from of ['"owner@example.org <owner@example.org>" <attacker@evil.test>', "Ann <ann@example.com>, Tarik <owner@example.org>", "Tarik <owner+tag@example.org>"]) {
      const d = deps({ fetchEmail: vi.fn(async () => ({ ...EMAIL, from })) });
      expect((await json(await handleInboundEmail(req(), d as never))).status).toBe("ignored");
      expect(d.save).not.toHaveBeenCalled();
    }
  });
  it("413 on a declared or actual body over the byte cap", async () => {
    const d = deps();
    const big = new Request("https://earmark.test/api/email/inbound", { method: "POST", headers: { "content-length": "999999" }, body: "{}" });
    expect((await handleInboundEmail(big, d as never)).status).toBe(413);
    const multibyte = new Request("https://earmark.test/api/email/inbound", { method: "POST", body: "é".repeat(140_000) }); // 140k chars, 280k bytes
    expect((await handleInboundEmail(multibyte, d as never)).status).toBe(413);
    expect(d.verify).not.toHaveBeenCalled();
  });
  it("uses the HTML body when the text part is an empty string", async () => {
    const d = deps({ fetchEmail: vi.fn(async () => ({ ...EMAIL, text: "", html: "<p>Listen to <b>Promises</b></p>" })) });
    await handleInboundEmail(req(), d as never);
    expect(d.extract.mock.calls[0]![0]!.text).toContain("Listen to Promises");
  });
  it("ignores other event types", async () => {
    const d = deps();
    const res = await handleInboundEmail(req('{"type":"email.sent","data":{"email_id":"e1"}}'), d as never);
    expect((await json(res)).status).toBe("ignored");
    expect(d.claim).not.toHaveBeenCalled();
  });
  it("a second delivery of the same email id is a 200 no-op", async () => {
    const d = deps({ claim: vi.fn(async () => false) });
    const res = await handleInboundEmail(req(), d as never);
    expect(res.status).toBe(200);
    expect((await json(res)).status).toBe("duplicate");
    expect(d.fetchEmail).not.toHaveBeenCalled();
    expect(d.save).not.toHaveBeenCalled();
  });
  it("ignores mail not forwarded by the owner and records it as ignored", async () => {
    const d = deps({ fetchEmail: vi.fn(async () => ({ ...EMAIL, from: "spam@x.com" })) });
    const res = await handleInboundEmail(req(), d as never);
    expect(res.status).toBe(200);
    expect((await json(res)).status).toBe("ignored");
    expect(d.save).not.toHaveBeenCalled();
    expect(d.triage).not.toHaveBeenCalled();
    expect(d.finish).toHaveBeenCalledWith("e1", "ignored", null);
  });
  it("ignores a message whose own headers say SPF failed", async () => {
    const d = deps({ fetchEmail: vi.fn(async () => ({ ...EMAIL, headers: { "Authentication-Results": "mx; spf=fail" } })) });
    expect((await json(await handleInboundEmail(req(), d as never))).status).toBe("ignored");
    expect(d.save).not.toHaveBeenCalled();
  });
  it("saves through saveCaptureRec as source 'email', with the forwarded sender's first name and the links", async () => {
    const d = deps();
    const res = await handleInboundEmail(req(), d as never);
    expect(res.status).toBe(201);
    expect(d.save.mock.calls[0]![0]).toMatchObject({
      type: "album", canonicalName: "Promises", creator: "Floating Points", source: "email", attributionSource: "email",
      recommenderName: "Ann", beeConversationId: null, status: "new", confidence: 0.9,
      links: { urls: ["https://music.apple.com/us/album/promises/1550583154"] },
    });
    expect(d.finish).toHaveBeenCalledWith("e1", "saved", 61);
    expect(d.afterCreated).toHaveBeenCalledWith(61);
  });
  it("hands the rec-lane work to the injected defer (route passes Next's after)", async () => {
    const { afterCreated: _drop, ...d } = deps();
    const defer = vi.fn();
    expect((await handleInboundEmail(req(), d as never, defer)).status).toBe(201);
    expect(defer).toHaveBeenCalledTimes(1);
    expect(typeof defer.mock.calls[0][0]).toBe("function");
  });
  it("never credits the owner as the recommender", async () => {
    const text = GMAIL_FORWARD.replace("Ann Smith <ann@example.com>", "Tarik Moody <owner@example.org>");
    const d = deps({ fetchEmail: vi.fn(async () => ({ ...EMAIL, text })) });
    await handleInboundEmail(req(), d as never);
    expect(d.save.mock.calls[0]![0]).toMatchObject({ recommenderName: null, attributionSource: "none" });
  });
  it("falls back to the extractor's name when there is no forwarded header", async () => {
    const text = "Ann says you have to hear Promises by Floating Points";
    const d = deps({
      fetchEmail: vi.fn(async () => ({ ...EMAIL, text })),
      extract: vi.fn(async () => ({ canonicalName: "Promises", creator: "Floating Points", recommenderName: "Ann", excerpt: text })),
    });
    await handleInboundEmail(req(), d as never);
    expect(d.save.mock.calls[0]![0]).toMatchObject({ recommenderName: "Ann", attributionSource: "email" });
  });
  it("keeps a forward triage doubts as needs_review instead of dropping it", async () => {
    const d = deps({ triage: vi.fn(async () => ({ ...REC_TRIAGE, kind: "neither", kindProbability: 0.8 })) });
    const res = await handleInboundEmail(req(), d as never);
    expect(res.status).toBe(201);
    expect(d.save.mock.calls[0]![0]).toMatchObject({ status: "needs_review", source: "email" });
    expect(d.save.mock.calls[0]![0].confidence).toBeCloseTo(0.2);
  });
  it("keeps a probable joke as needs_review", async () => {
    const d = deps({ triage: vi.fn(async () => ({ ...REC_TRIAGE, jokingProbability: 0.9 })) });
    await handleInboundEmail(req(), d as never);
    expect(d.save.mock.calls[0]![0].status).toBe("needs_review");
  });
  it("a recType of none is saved as 'other'", async () => {
    const d = deps({ triage: vi.fn(async () => ({ ...REC_TRIAGE, recType: "none", kindProbability: Number.NaN })) });
    await handleInboundEmail(req(), d as never);
    expect(d.save.mock.calls[0]![0]).toMatchObject({ type: "other", confidence: 0 });
  });
  it("a duplicate found by the save is a 200 and schedules nothing", async () => {
    const d = deps({ save: vi.fn(async () => ({ id: 61, upgraded: false, duplicate: true })) });
    const res = await handleInboundEmail(req(), d as never);
    expect(res.status).toBe(200);
    expect(d.finish).toHaveBeenCalledWith("e1", "duplicate", 61);
    expect(d.afterCreated).not.toHaveBeenCalled();
  });
  it("an empty email is ignored", async () => {
    const d = deps({ fetchEmail: vi.fn(async () => ({ ...EMAIL, subject: "", text: "  ", html: null })) });
    expect((await json(await handleInboundEmail(req(), d as never))).status).toBe("ignored");
    expect(d.triage).not.toHaveBeenCalled();
  });
  it("releases the claim and answers a generic 500 when processing fails, logging only the error name", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    class Boom extends Error { override name = "BoomError"; }
    const d = deps({ extract: vi.fn(async () => { throw new Boom("secret subject Fwd: you need this album"); }) });
    const res = await handleInboundEmail(req(), d as never);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret");
    expect(d.release).toHaveBeenCalledWith("e1");
    expect(d.save).not.toHaveBeenCalled();
    const logged = log.mock.calls.flat().join(" ");
    expect(logged).toContain("BoomError");
    expect(logged).not.toContain("secret");
  });
  it("a failure while scheduling the rec lane does not fail the capture", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const d = deps({ afterCreated: vi.fn(() => { throw new Error("x"); }) });
    expect((await handleInboundEmail(req(), d as never)).status).toBe(201);
  });
});
