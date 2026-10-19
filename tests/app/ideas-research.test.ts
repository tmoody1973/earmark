import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../app/ideas/[id]/actions", () => ({ researchIdea: vi.fn() }));

import type { IdeaResearch } from "../../agent/lib/ideas/research";
import { Research } from "../../app/ideas/[id]/Research";

// The idea page's Research panel (decision 057), one state at a time.
const at = "2026-10-19T15:00:00.000Z";
const html = (research: IdeaResearch | null, enabled = true) => renderToStaticMarkup(createElement(Research, { ideaId: 7, research, enabled }));
const row = (over: Partial<IdeaResearch>): IdeaResearch => ({ status: "requested", requestedAt: at, doneAt: null, briefMd: null, ...over });
const BRIEF = "## What already exists\nMaricopa runs Mari [1]. <img src=x onerror=alert(1)>\n\n## Sources\n1. Mari — maricopa.gov — [maricopa.gov/mari](https://www.maricopa.gov/mari)\n2. Bad — [x](javascript:alert(1))";

describe("Research panel", () => {
  it("never asked: offers Research this; nothing at all when research is off and there is no brief", () => {
    expect(html(null)).toContain("Research this");
    expect(html(null, false)).toBe("");
  });

  it("requested or running: says it is researching, no button", () => {
    for (const status of ["requested", "running"] as const) {
      const h = html(row({ status }));
      expect(h).toContain("Researching… usually a few minutes.");
      expect(h).not.toContain("<button");
    }
  });

  it("done: the brief through the safe renderer (no raw HTML, https links in a new tab), the date and Research again", () => {
    const h = html(row({ status: "done", doneAt: at, briefMd: BRIEF }));
    expect(h).toContain("<h3>What already exists</h3>"); // under the panel's h2
    expect(h).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(h).not.toContain("<img");
    expect(h).toContain('<a href="https://www.maricopa.gov/mari" rel="noopener noreferrer" target="_blank">maricopa.gov/mari</a>');
    expect(h).not.toContain('href="javascript');
    expect(h).toContain("Researched Oct 19");
    expect(h).toContain("Research again");
  });

  it("failed: says so and offers Research again", () => {
    const h = html(row({ status: "failed" }));
    expect(h).toContain("Couldn’t research this. Try again.");
    expect(h).toContain("Research again");
  });

  it("a dismissed idea (enabled false) still shows the brief it has, with no button", () => {
    const h = html(row({ status: "done", doneAt: at, briefMd: BRIEF }), false);
    expect(h).toContain("Maricopa runs Mari [1].");
    expect(h).not.toContain("<button");
  });
});
