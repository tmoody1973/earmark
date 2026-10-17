import { describe, expect, it } from "vitest";
import { checkText } from "../../../agent/lib/episode/guard";

const data = {
  growing: [], ready: [], dontForget: [], thanksOwed: [],
  newInCrate: [{ canonical_name: "Ann Arbor Film Fest", first_name: "Ann" }, { canonical_name: "Promises", first_name: "Ben" }],
};
const check = (t: string) => checkText(t, data, "Odette");

describe("checkText", () => {
  it("passes a clean script", () => {
    expect(check('Ann suggested Promises. Ben said "listen at night". Everyone said hello. Ann Arbor Film Fest is on.')).toEqual([]);
  });
  it("rejects the owner's name", () => expect(check("Odette, you did well.")).toEqual(["owner"]));
  it("rejects a quote over 25 words, straight or curly", () => {
    const long = "word ".repeat(26).trim();
    expect(check(`Ann said "${long}".`)).toContain("excerpt");
    expect(check(`Ann said “${long}”.`)).toContain("excerpt");
    expect(check(`Ann said "${"word ".repeat(25).trim()}".`)).toEqual([]);
  });
  it("rejects a surname after a known first name", () => expect(check("Ben Carter suggested it.")).toContain("surname"));
  it("rejects an unknown name in a said/recommended pattern", () => expect(check("Marcus recommended it.")).toEqual(["unknown_name"]));
});
