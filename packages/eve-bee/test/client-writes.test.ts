import { describe, expect, it, vi } from "vitest";
import { BeeApiError, createBeeClient } from "../src/client.ts";

const reply = (body: unknown, status = 200) =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
const client = (f: ReturnType<typeof reply>) =>
  createBeeClient({ token: "tok", baseUrl: "https://bee.test", fetchImpl: f as unknown as typeof fetch });

describe("Bee todo writes (M3-T7)", () => {
  it("creates a todo with its text and reads the id from a wrapped reply", async () => {
    const f = reply({ todo: { id: 12, text: "Earmark · x", completed: false, alarm_at: null } });
    expect(await client(f).createTodo({ text: "Earmark · x" })).toMatchObject({ id: 12 });
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe("https://bee.test/v1/todos");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ text: "Earmark · x" });
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok");
  });

  it("accepts a bare reply, and an unexpected extra field never throws (the todo already exists)", async () => {
    expect(await client(reply({ id: 13, text: "t", surprise: true })).createTodo({ text: "t" })).toMatchObject({ id: 13 });
  });

  it("sends alarm_at as given (ISO 8601 in, per the Bee API doc) only when alarmAt is set", async () => {
    const f = reply({ id: 14 });
    await client(f).createTodo({ text: "Earmark · y", alarmAt: "2026-10-20T15:00:00.000Z" });
    await client(f).createTodo({ text: "Earmark · z", alarmAt: null });
    expect(JSON.parse(String(f.mock.calls[0]![1]?.body))).toEqual({ text: "Earmark · y", alarm_at: "2026-10-20T15:00:00.000Z" });
    expect(JSON.parse(String(f.mock.calls[1]![1]?.body))).toEqual({ text: "Earmark · z" });
  });

  it("updates with only the given fields", async () => {
    const f = reply("");
    await client(f).updateTodo(12, { completed: true });
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe("https://bee.test/v1/todos/12");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({ completed: true });
  });

  it("surfaces a 404 as BeeApiError with its status (the reconciler counts it as gone)", async () => {
    const err = await client(reply("not found", 404)).updateTodo(99, { completed: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BeeApiError);
    expect((err as BeeApiError).status).toBe(404);
  });
});
