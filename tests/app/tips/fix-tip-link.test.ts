import { describe, expect, it } from "vitest";
import { linkChanged } from "../../../app/tips/[id]/link-change";

// The Link box starts with the tip's known link: the owner's own (Bandcamp, a website) or the one a lookup found.
const apple = "https://music.apple.com/us/album/glass-harbor/1";
const bandcamp = "https://maravell.bandcamp.com/album/glass-harbor";

describe("linkChanged", () => {
  it("an untouched box, or one with only spaces added, is no change", () => {
    expect(linkChanged({ link: apple, ownLink: false }, apple)).toBe(false);
    expect(linkChanged({ link: bandcamp, ownLink: true }, ` ${bandcamp} `)).toBe(false);
    expect(linkChanged({ link: null, ownLink: false }, "")).toBe(false);
  });

  it("a different link is a change, whoever's link was there", () => {
    expect(linkChanged({ link: apple, ownLink: false }, bandcamp)).toBe(true);
    expect(linkChanged({ link: null, ownLink: false }, bandcamp)).toBe(true);
  });

  it("clearing the owner's own link is a change; clearing a link a lookup found is not (only the owner's can be cleared)", () => {
    expect(linkChanged({ link: bandcamp, ownLink: true }, "")).toBe(true);
    expect(linkChanged({ link: apple, ownLink: false }, "")).toBe(false);
  });
});
