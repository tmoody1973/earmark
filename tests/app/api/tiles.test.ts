import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clerk = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => clerk);

import { GET } from "../../../app/api/tiles/[z]/[x]/[y]/route";

const fetchMock = vi.fn();
const get = (z: string, x: string, y: string) =>
  GET(new Request(`https://x.test/api/tiles/${z}/${x}/${y}`), { params: Promise.resolve({ z, x, y }) });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EARMARK_OWNER_CLERK_ID = "user_owner";
  clerk.auth.mockResolvedValue({ userId: "user_owner" });
  fetchMock.mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("GET /api/tiles/[z]/[x]/[y]", () => {
  it.each([["a signed-in stranger", "user_stranger"], ["a signed-out visitor", null]])(
    "is a 404 for %s and never touches OpenStreetMap",
    async (_label, userId) => {
      clerk.auth.mockResolvedValue({ userId });
      expect((await get("16", "16765", "24071")).status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["another zoom", "15", "16765", "24071"],
    ["x past the edge of the z16 grid", "16", "65536", "24071"],
    ["a negative x", "16", "-1", "24071"],
    ["exponent notation", "16", "1e3", "24071"],
  ])("is a 400 for %s, without fetching", async (_label, z, x, y) => {
    expect((await get(z, x, y)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches exactly one tile with an identifying User-Agent and lets only the owner's browser cache it", async () => {
    const res = await get("16", "16765", "24071");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://tile.openstreetmap.org/16/16765/24071.png");
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/^Earmark\/.+github\.com\/tmoody1973\/earmark/);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toMatch(/^private, max-age=\d+$/);
  });

  it("is a 502 when OpenStreetMap refuses, so the card falls back to its no-map state", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 429 }));
    expect((await get("16", "16765", "24071")).status).toBe(502);
  });

  it("logs only the error name when the fetch throws (no coordinates, no message)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED 16/16765/24071"), { name: "TypeError" }));
    expect((await get("16", "16765", "24071")).status).toBe(502);
    expect(err).toHaveBeenCalledWith("[tiles] fetch failed error=TypeError");
    err.mockRestore();
  });
});
