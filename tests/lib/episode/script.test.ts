import { expect, it, vi } from "vitest";
import { writeEpisodeScript } from "../../../agent/lib/episode/script";

const data = { growing: [], ready: [], newInCrate: [], dontForget: [], thanksOwed: [] };
const good = (extra = "") => ({ output: { title: "Right", script: `${"word ".repeat(900)}${extra}` } });

it("retries once when the script is outside 700–1100 words", async () => {
  const generateImpl = vi.fn()
    .mockResolvedValueOnce({ output: { title: "Short", script: "too short" } })
    .mockResolvedValueOnce(good());
  const out = await writeEpisodeScript(data, "2026-10-18", generateImpl as never, "Odette");
  expect(out.title).toBe("Right");
  expect(generateImpl.mock.calls[1][0].prompt).toContain("was 2 words");
});

it("uses instructions (not system) and passes no retry text on a good first draft", async () => {
  const generateImpl = vi.fn().mockResolvedValueOnce(good());
  await writeEpisodeScript(data, "2026-10-18", generateImpl as never, "Odette");
  expect(generateImpl).toHaveBeenCalledTimes(1);
  expect(generateImpl.mock.calls[0][0].abortSignal).toBeInstanceOf(AbortSignal); // capped inside the gardener's 5-minute lease
  expect(generateImpl.mock.calls[0][0].instructions).toContain("Earmark");
  expect(generateImpl.mock.calls[0][0]).not.toHaveProperty("system");
});

it("retries when the owner's own name appears, and fails closed if it still does", async () => {
  const ok = vi.fn().mockResolvedValueOnce(good(" Odette said so")).mockResolvedValueOnce(good());
  await writeEpisodeScript(data, "2026-10-18", ok as never, "Odette");
  expect(ok.mock.calls[1][0].prompt).toContain("owner");

  const bad = vi.fn().mockResolvedValue(good(" Odette said so"));
  await expect(writeEpisodeScript(data, "2026-10-18", bad as never, "Odette")).rejects.toThrow(/owner/);
  expect(bad).toHaveBeenCalledTimes(3); // first draft plus two retries
});

it("applies the same checks to the title, and to excerpt length and names in the script", async () => {
  const t = vi.fn()
    .mockResolvedValueOnce({ output: { title: "Odette's week", script: "word ".repeat(900) } })
    .mockResolvedValueOnce(good());
  await writeEpisodeScript(data, "2026-10-18", t as never, "Odette");
  expect(t.mock.calls[1][0].prompt).toContain("owner");

  const q = vi.fn().mockResolvedValue({ output: { title: "T", script: `Ann said "${"w ".repeat(30)}" ${"word ".repeat(900)}` } });
  await expect(writeEpisodeScript(data, "2026-10-18", q as never, "Odette")).rejects.toMatchObject({ name: "ScriptRejectedError", message: expect.not.stringContaining("w w") });
  expect(q).toHaveBeenCalledTimes(3);
});

it("sends the exact offending phrase back to the model, but never into the error or logs", async () => {
  const d = { ...data, newInCrate: [{ canonical_name: "Promises", first_name: "Ann" }] };
  const bad = { output: { title: "T", script: `Ann Smithers suggested it. ${"word ".repeat(900)}` } };
  const g = vi.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce(good());
  const seen: unknown[] = [];
  const out = await writeEpisodeScript(d, "2026-10-18", g as never, "Odette", (i) => seen.push(i));
  expect(out.title).toBe("Right");
  expect(g.mock.calls[1][0].prompt).toContain("Ann Smithers");
  expect(seen).toEqual([{ attempt: 1, reasons: ["surname", "unknown_name"] }, { attempt: 2, reasons: [] }]);

  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const always = vi.fn().mockResolvedValue(bad);
  const e = await writeEpisodeScript(d, "2026-10-18", always as never, "Odette").catch((x) => x);
  expect(e.name).toBe("ScriptRejectedError");
  expect(JSON.stringify([e.message, e.reasons, err.mock.calls, log.mock.calls])).not.toContain("Smithers");
  expect(always).toHaveBeenCalledTimes(3);
  err.mockRestore(); log.mockRestore();
});
