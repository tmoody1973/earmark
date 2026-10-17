import { beforeEach, describe, expect, it, vi } from "vitest";

const sql = vi.fn();
vi.mock("../../../agent/lib/db", () => ({ db: () => sql }));
import { runEpisode, weekOfSunday } from "../../../agent/lib/episode/publish";

beforeEach(() => sql.mockReset());

describe("weekOfSunday", () => {
  it("returns the Chicago Sunday on or before now", () => {
    expect(weekOfSunday(new Date("2026-10-18T17:00:00Z"))).toBe("2026-10-18");
    expect(weekOfSunday(new Date("2026-10-21T17:00:00Z"))).toBe("2026-10-18");
    expect(weekOfSunday(new Date("2026-10-18T03:00:00Z"))).toBe("2026-10-11"); // still Saturday night in Chicago
  });
});

describe("runEpisode", () => {
  it("is idempotent per week", async () => {
    sql.mockResolvedValueOnce([{ id: "8", title: "Week of Oct 18" }]);
    const write = vi.fn();
    expect(await runEpisode(new Date("2026-10-18T17:00:00Z"), { write } as never)).toEqual({ episodeId: 8, title: "Week of Oct 18" });
    expect(write).not.toHaveBeenCalled();
  });
  it("writes, voices, uploads publicly and stores an unpublished episode", async () => {
    sql.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "9" }]);
    const deps = {
      gather: vi.fn(async () => ({})),
      write: vi.fn(async () => ({ title: "The ramen week", script: "Hello." })),
      voice: vi.fn(async () => new Uint8Array([1, 2, 3])),
      upload: vi.fn(async () => "https://blob.test/episodes/earmark-2026-10-18-x.mp3"),
    };
    expect(await runEpisode(new Date("2026-10-18T17:00:00Z"), deps as never)).toEqual({ episodeId: 9, title: "The ramen week" });
    expect(deps.upload).toHaveBeenCalledWith("2026-10-18", expect.any(Uint8Array));
    const insert = sql.mock.calls[1].slice(1);
    expect(insert).toEqual(expect.arrayContaining(["2026-10-18", "https://blob.test/episodes/earmark-2026-10-18-x.mp3", 3]));
    expect(insert.join(" ")).not.toContain("published"); // never published by this path
  });
  it("removes the uploaded audio and logs only the error name when the insert fails", async () => {
    sql.mockResolvedValueOnce([]).mockRejectedValueOnce(new TypeError("secret detail: Hello."));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = {
      gather: async () => ({}), write: async () => ({ title: "T", script: "Hello." }),
      voice: async () => new Uint8Array([1]), upload: async () => "https://blob.test/a.mp3", remove: vi.fn(async () => {}),
    };
    await expect(runEpisode(new Date("2026-10-18T17:00:00Z"), deps as never)).rejects.toThrow();
    expect(deps.remove).toHaveBeenCalledWith("https://blob.test/a.mp3");
    const logged = err.mock.calls.flat().join(" ");
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("secret detail");
    err.mockRestore();
  });
});
