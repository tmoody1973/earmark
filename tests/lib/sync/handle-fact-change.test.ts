import { beforeEach, describe, expect, it, vi } from "vitest";

const sql = vi.fn();
vi.mock("../../../agent/lib/db", () => ({ db: () => sql }));
const getFact = vi.fn();
vi.mock("../../../agent/lib/bee/client", async (orig) => ({
  ...(await orig<object>()),
  createBeeClient: () => ({ getFact }),
}));
import { BeeApiError } from "../../../agent/lib/bee/client";
import { handleFactChange } from "../../../agent/lib/sync/handlers";

const q = (i: number) => (sql.mock.calls[i][0] as TemplateStringsArray).join("?");
beforeEach(() => { sql.mockReset(); getFact.mockReset(); });

describe("handleFactChange", () => {
  it("ignores facts Earmark did not write", async () => {
    sql.mockResolvedValueOnce([]);
    await handleFactChange(77);
    expect(getFact).not.toHaveBeenCalled();
  });

  it("marks a proposal confirmed and links an idea fact to its cluster", async () => {
    sql.mockResolvedValueOnce([{ id: 5, kind: "idea", evidence_ids: [12], status: "pending" }]).mockResolvedValue([]);
    getFact.mockResolvedValueOnce({ id: 77, text: "x", confirmed: true });
    await handleFactChange(77);
    expect(q(1)).toContain("status = 'confirmed'");
    expect(q(2)).toContain("update idea_clusters set bee_fact_id");
    expect(sql.mock.calls[2].slice(1)).toEqual([77, 12]);
  });

  it("marks a taste proposal confirmed without touching idea clusters", async () => {
    sql.mockResolvedValueOnce([{ id: 6, kind: "taste", evidence_ids: [1, 2, 3], status: "pending" }]).mockResolvedValue([]);
    getFact.mockResolvedValueOnce({ id: 78, text: "x", confirmed: true });
    await handleFactChange(78);
    expect(sql).toHaveBeenCalledTimes(2);
    expect(q(1)).toContain("status = 'confirmed'");
  });

  it("leaves a still-unconfirmed or already-confirmed proposal as it is", async () => {
    sql.mockResolvedValueOnce([{ id: 5, kind: "taste", evidence_ids: [1, 2, 3], status: "pending" }]);
    getFact.mockResolvedValueOnce({ id: 77, text: "x", confirmed: false });
    await handleFactChange(77);
    sql.mockResolvedValueOnce([{ id: 5, kind: "taste", evidence_ids: [1, 2, 3], status: "confirmed" }]);
    getFact.mockResolvedValueOnce({ id: 77, text: "x", confirmed: true });
    await handleFactChange(77);
    expect(sql).toHaveBeenCalledTimes(2);
  });

  it("mirrors a deletion in Bee as rejected and drops the sync row", async () => {
    sql.mockResolvedValueOnce([{ id: 5, kind: "taste", evidence_ids: [1, 2, 3], status: "pending" }]).mockResolvedValue([]);
    getFact.mockRejectedValueOnce(new BeeApiError(404, "/v1/facts/77", "not found"));
    await handleFactChange(77);
    expect(q(1)).toContain("status = 'rejected'");
    expect(q(2)).toContain("delete from bee_sync");
  });

  it("re-throws other Bee errors so the changes batch replays", async () => {
    sql.mockResolvedValueOnce([{ id: 5, kind: "taste", evidence_ids: [1, 2, 3], status: "pending" }]);
    const boom = new BeeApiError(500, "/v1/facts/77", "boom");
    getFact.mockRejectedValueOnce(boom);
    await expect(handleFactChange(77)).rejects.toBe(boom);
    expect(sql).toHaveBeenCalledTimes(1);
  });
});
