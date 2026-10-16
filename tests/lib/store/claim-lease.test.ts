import { describe, expect, it, vi } from "vitest";

vi.mock("../../../agent/lib/db", () => ({ db: () => () => Promise.resolve([]) }));

import { CLAIM_LEASE } from "../../../agent/lib/store/conversations";

describe("CLAIM_LEASE", () => {
  // Must stay strictly longer than the longest function duration that can process one conversation (see the comment on it).
  it("is pinned at 15 minutes", () => {
    expect(CLAIM_LEASE).toBe("15 minutes");
  });
});
