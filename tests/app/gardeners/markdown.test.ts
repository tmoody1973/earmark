import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/app/gardeners/markdown";

const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

describe("gardener Markdown", () => {
  it("renders headings, bold, italic, code", () => {
    const out = html("## Title\n\nSome **bold** and *it* and `x`.");
    expect(out).toContain("<h4>Title</h4>");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>it</em>");
    expect(out).toContain("<code>x</code>");
    expect(out).not.toContain("##");
  });
  it("renders bullet and numbered lists", () => {
    const out = html("- a\n- b\n\n1. one\n2. two");
    expect(out).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(out).toContain("<ol><li>one</li><li>two</li></ol>");
  });
  it("keeps https links with rel, rejects other schemes", () => {
    expect(html("[ok](https://example.com/a)")).toContain('<a href="https://example.com/a" rel="noopener noreferrer"');
    const bad = html("[x](javascript:alert(1)) [y](http://example.com)");
    expect(bad).not.toContain("<a");
    expect(bad).toContain("[x](javascript:alert(1))");
  });
  it("renders raw HTML as literal text", () => {
    const out = html('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&lt;img");
  });
  it("passes plain text through", () => {
    expect(html("Just a sentence.")).toBe('<div class="g-md"><p>Just a sentence.</p></div>');
  });
});
