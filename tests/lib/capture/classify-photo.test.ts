import { describe, expect, it, vi } from "vitest";
import { classifyPhoto, readPhoto } from "../../../agent/lib/capture/classify-photo";

vi.mock("../../../agent/lib/capture/photo-model", () => ({ photoDecisionModel: async () => "openai/gpt-6-luna-decisions" }));

const bytes = new Uint8Array([0xff, 0xd8, 0xff]);

describe("classifyPhoto", () => {
  it("sends the image as a file part and maps all three answers", async () => {
    const decideImpl = vi.fn(async (opts: { state: { type: string; mediaType: string }[] }) => {
      expect(opts.state[0]).toMatchObject({ type: "file", mediaType: "image/jpeg" });
      return {
        answers: {
          item: { type: "choice", choice: "a_specific_item", probabilities: { a_specific_item: 0.93, no_specific_item: 0.07 } },
          rec_type: { type: "choice", choice: "album", probabilities: { album: 0.88 } },
          has_person: { type: "boolean", probability: 0.03 },
        },
      };
    });
    const c = await classifyPhoto(bytes, "image/jpeg", decideImpl as never);
    expect(c).toEqual({ itemProbability: 0.93, recType: "album", recTypeProbability: 0.88, personProbability: 0.03 });
  });
  it("maps rec_type 'none' to 'other'", async () => {
    const decideImpl = vi.fn(async () => ({
      answers: {
        item: { type: "choice", choice: "a_specific_item", probabilities: { a_specific_item: 0.7 } },
        rec_type: { type: "choice", choice: "none", probabilities: { none: 0.6 } },
        has_person: { type: "boolean", probability: 0.5 },
      },
    }));
    expect((await classifyPhoto(bytes, "image/jpeg", decideImpl as never)).recType).toBe("other");
  });
});

describe("classifyPhoto fail-closed", () => {
  it("treats a non-boolean has_person answer as a person being present", async () => {
    const decideImpl = vi.fn(async () => ({
      answers: {
        item: { type: "choice", choice: "a_specific_item", probabilities: { a_specific_item: 0.9 } },
        rec_type: { type: "choice", choice: "book", probabilities: { book: 0.9 } },
        has_person: { type: "choice", choice: "x" },
      },
    }));
    expect((await classifyPhoto(bytes, "image/jpeg", decideImpl as never)).personProbability).toBe(1);
  });
});

describe("readPhoto", () => {
  it("passes the image and returns the parsed object", async () => {
    const generateImpl = vi.fn(async (opts: { messages: { content: { type: string }[] }[] }) => {
      expect(opts.messages[0].content.map((p) => p.type)).toEqual(["text", "file"]); // "image" parts are deprecated
      return { output: { title: "Promises", creator: "Floating Points", visibleText: "PROMISES" } };
    });
    expect(await readPhoto(bytes, "image/jpeg", generateImpl as never)).toEqual({
      title: "Promises", creator: "Floating Points", visibleText: "PROMISES",
    });
  });
});
