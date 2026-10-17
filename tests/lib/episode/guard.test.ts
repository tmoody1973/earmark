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

describe("checkText: allowlists and patterns", () => {
  const d = {
    growing: [], ready: [], dontForget: [], thanksOwed: [],
    newInCrate: [
      { canonical_name: "Ann Arbor Farmers Market", excerpt: "Ann Smith told me, and Smith loves it", first_name: "Ann" },
      { canonical_name: "Promises", creator: "Floating Points", first_name: "Marcus" },
    ],
  };
  const c = (t: string) => checkText(t, d, "Odette");
  it("allows a first name + word only from catalog fields, never from an excerpt", () => {
    expect(c("Ann Arbor has a market.")).toEqual([]);
    expect(c("Ann Smith suggested it.")).toContain("surname");
  });
  it("matches unknown speakers against the first-name list exactly, not by substring", () => {
    expect(c("Mar said so.")).toContain("unknown_name");
    expect(c("Smith said so.")).toContain("unknown_name");
    expect(c("Marcus said so.")).toEqual([]);
  });
  it("checks single curly quotes and guillemets, but not contraction apostrophes", () => {
    const long = "word ".repeat(26).trim();
    expect(c(`Marcus said ‘${long}’.`)).toContain("excerpt");
    expect(c(`Marcus said «${long}».`)).toContain("excerpt");
    expect(c("Marcus said it’s fine and don’t worry.")).toEqual([]);
  });
  it("catches Unicode, hyphenated, apostrophe and particle surnames, and 'by/from First Last'", () => {
    for (const sn of ["O’Brien", "Müller", "Smith-Jones", "de la Cruz", "O'Brien"]) expect(c(`Marcus ${sn} suggested it.`)).toContain("surname");
    expect(c("It was recommended by Priya Rao.")).toContain("unknown_name");
    expect(c("A tip from Ann Smith.")).toContain("surname");
  });
});
