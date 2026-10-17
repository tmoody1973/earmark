import { beforeEach, expect, it, vi } from "vitest";

const sql = vi.fn();
vi.mock("../../agent/lib/db", () => ({ db: () => sql }));
import { GET, dynamic } from "../../app/feed/[token]/route";

beforeEach(() => { sql.mockReset(); process.env.EARMARK_FEED_TOKEN = "f".repeat(40); });
const call = (token: string) => GET(new Request("https://earmark.test/feed/x"), { params: Promise.resolve({ token }) });

it("is never prerendered", () => expect(dynamic).toBe("force-dynamic"));
it("404s on a wrong token without touching the database", async () => {
  expect((await call("nope")).status).toBe(404);
  expect(sql).not.toHaveBeenCalled();
});
it("escapes titles and lists enclosures", async () => {
  sql.mockResolvedValueOnce([{ week_of: "2026-10-18", script_md: "Ramen & <jazz>\n\nHello there.", audio_url: "https://blob.test/a.mp3", audio_bytes: 1234, published_at: "2026-10-18T14:00:00Z" }]);
  const res = await call("f".repeat(40));
  const xml = await res.text();
  expect(res.headers.get("content-type")).toContain("application/rss+xml");
  expect(xml).toContain("<title>Ramen &amp; &lt;jazz&gt;</title>");
  expect(xml).toContain('length="1234"');
  expect(xml).toContain('type="audio/mpeg"');
  expect(xml).toContain("<link>https://earmark.test</link>");
  expect(xml).toContain("<itunes:block>Yes</itunes:block>");
});
it("only ever queries approved episodes", async () => {
  sql.mockResolvedValueOnce([]);
  await call("f".repeat(40));
  expect((sql.mock.calls[0][0] as string[]).join(" ")).toContain("published_at is not null");
});
it("404s (not 500) when the config is malformed, so the route is not confirmed", async () => {
  vi.resetModules();
  process.env.EARMARK_FEED_TOKEN = "short";
  const { GET: G } = await import("../../app/feed/[token]/route");
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await G(new Request("https://earmark.test/feed/x"), { params: Promise.resolve({ token: "short" }) })).status).toBe(404);
  err.mockRestore();
});
