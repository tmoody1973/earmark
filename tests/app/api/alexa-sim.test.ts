import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ userId: "owner" as string | null, runTurn: vi.fn(async () => ({ answer: "hi", toolsUsed: [] as string[] })) }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: h.userId }) }));
vi.mock("../../../agent/lib/alexa/sim", async (orig) => ({ ...(await orig<typeof import("../../../agent/lib/alexa/sim")>()), runTurn: h.runTurn }));
import { POST } from "../../../app/api/alexa-sim/route";

const post = (body: unknown) => new Request("https://earmark.test/api/alexa-sim", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => { process.env.EARMARK_OWNER_CLERK_ID = "owner"; h.userId = "owner"; h.runTurn.mockClear(); });

describe("POST /api/alexa-sim", () => {
  it("404s a non-owner before reading the body or running a turn", async () => {
    h.userId = "someone";
    expect((await POST(post({ question: "hi", history: [] }))).status).toBe(404);
    h.userId = null;
    expect((await POST(post({ question: "hi", history: [] }))).status).toBe(404);
    expect(h.runTurn).not.toHaveBeenCalled();
  });
  it("400s bad JSON and over-cap input", async () => {
    expect((await POST(post("{nope"))).status).toBe(400);
    expect((await POST(post({ question: "x".repeat(301), history: [] }))).status).toBe(400);
    expect(h.runTurn).not.toHaveBeenCalled();
  });
  it("runs a turn for the owner with the request origin", async () => {
    const res = await POST(post({ question: "hi", history: [] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ answer: "hi", toolsUsed: [] });
    expect(h.runTurn).toHaveBeenCalledWith({ question: "hi", history: [], origin: "https://earmark.test" });
  });
});
