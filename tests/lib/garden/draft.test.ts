import { describe, expect, it } from "vitest";
import { draftBlocks, inlineRuns } from "../../../agent/lib/garden/draft";

describe("draftBlocks", () => {
  it("reads the one-pager's headings, paragraphs and lists as blocks", () => {
    const md = [
      "Mentioned 3 times: Sep 12 · Oct 3 · Oct 15",
      "",
      "# A CRM for Public Radio",
      "",
      "## Problem",
      "Stations deal with several groups.",
      "They are not seen together.",
      "",
      "- Import one station's records.",
      "- Show one dashboard.",
      "1. first",
      "2. second",
    ].join("\n");
    expect(draftBlocks(md)).toEqual([
      { kind: "p", text: "Mentioned 3 times: Sep 12 · Oct 3 · Oct 15" },
      { kind: "h", level: 1, text: "A CRM for Public Radio" },
      { kind: "h", level: 2, text: "Problem" },
      { kind: "p", text: "Stations deal with several groups. They are not seen together." },
      { kind: "ul", items: ["Import one station's records.", "Show one dashboard."] },
      { kind: "ol", items: ["first", "second"] },
    ]);
  });
  it("treats raw HTML as plain text (React escapes it)", () => {
    expect(draftBlocks("<script>x</script>")).toEqual([{ kind: "p", text: "<script>x</script>" }]);
  });
  it("returns [] for an empty draft", () => {
    expect(draftBlocks("  \n\n")).toEqual([]);
  });
});

describe("inlineRuns", () => {
  it("splits **bold** runs and leaves the rest as text", () => {
    expect(inlineRuns("a **b** c")).toEqual([{ bold: false, text: "a " }, { bold: true, text: "b" }, { bold: false, text: " c" }]);
    expect(inlineRuns("no marks")).toEqual([{ bold: false, text: "no marks" }]);
  });
});

describe("draftBlocks heading levels", () => {
  it("maps the shallowest heading present to level 1", () => {
    const out = draftBlocks("## Problem\ntext\n### Detail");
    expect(out.filter((b) => b.kind === "h")).toEqual([
      { kind: "h", level: 1, text: "Problem" },
      { kind: "h", level: 2, text: "Detail" },
    ]);
  });
});
