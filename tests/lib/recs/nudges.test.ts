import { describe, expect, it, vi } from "vitest";
import { chicagoDate, handleLocationUpdate, nearestWithin, toCandidate, type NudgeDeps } from "../../../agent/lib/recs/nudges";

const ramen = { id: 5, canonicalName: "Ramen Kyuu", recommenderName: "Ann", lat: 43.0418, lng: -87.9097 };
const far = { id: 6, canonicalName: "Far Cafe", recommenderName: null, lat: 43.1, lng: -87.9 };
const HERE = { latitude: 43.0425, longitude: -87.9097 };

describe("nearestWithin", () => {
  it("picks the closest candidate inside the radius", () => {
    const hit = nearestWithin([far, ramen], { lat: 43.0425, lng: -87.9097 }, 300);
    expect(hit?.id).toBe(5);
    expect(hit?.distanceM).toBeLessThan(100);
  });
  it("returns null when everything is outside the radius", () => {
    expect(nearestWithin([far], { lat: 43.0418, lng: -87.9097 }, 300)).toBeNull();
  });
});

describe("chicagoDate", () => {
  it("uses the Chicago calendar day, not UTC", () => {
    expect(chicagoDate(new Date("2026-10-19T03:30:00Z"))).toBe("2026-10-18");
  });
});

describe("toCandidate", () => {
  const row = { id: 5, canonical_name: "Ramen Kyuu", lat: 43.04, lng: -87.9, recommender_id: 2, first_name: "Ann" };
  it("names the recommender", () => {
    expect(toCandidate(row, "Tarik")?.recommenderName).toBe("Ann");
  });
  it("never credits the owner (first name, any case)", () => {
    expect(toCandidate({ ...row, first_name: "tarik" }, "Tarik Moody")?.recommenderName).toBeNull();
  });
});

describe("handleLocationUpdate", () => {
  const base = () => ({
    candidates: vi.fn(async () => [ramen]),
    claim: vi.fn(async () => true),
    release: vi.fn(async () => undefined),
    setTodoId: vi.fn(async () => undefined),
    createTodo: vi.fn<NudgeDeps["createTodo"]>(async () => ({ todoId: 99 })),
    now: () => new Date("2026-10-18T19:00:00Z"),
    radiusM: 300,
  });
  it("creates one Bee todo due now with the recommender's name", async () => {
    const d = base();
    expect(await handleLocationUpdate(HERE, d)).toBe("nudged");
    expect(d.createTodo).toHaveBeenCalledWith({
      entityType: "place_nudge", entityId: 5,
      text: "Earmark · You're near Ramen Kyuu — Ann recommended it",
      alarmAt: "2026-10-18T19:00:00.000Z",
    });
    expect(d.setTodoId).toHaveBeenCalledWith(5, "2026-10-18", 99);
  });
  it("uses the no-name text when there is no credited recommender", async () => {
    const d = { ...base(), candidates: vi.fn(async () => [{ ...ramen, recommenderName: null }]) };
    await handleLocationUpdate(HERE, d);
    expect(d.createTodo.mock.calls[0]![0].text).toBe("Earmark · You're near Ramen Kyuu");
  });
  it("does nothing the second time the same day", async () => {
    const d = { ...base(), claim: vi.fn(async () => false) };
    expect(await handleLocationUpdate(HERE, d)).toBe("already");
    expect(d.createTodo).not.toHaveBeenCalled();
  });
  it("reports the 10-todo cap without throwing, keeping the claim", async () => {
    const d = { ...base(), createTodo: vi.fn<NudgeDeps["createTodo"]>(async () => ({ skipped: "cap" })) };
    expect(await handleLocationUpdate(HERE, d)).toBe("capped");
    expect(d.release).not.toHaveBeenCalled();
  });
  it("keeps the claim when the Bee todo switch is off", async () => {
    const d = { ...base(), createTodo: vi.fn<NudgeDeps["createTodo"]>(async () => ({ skipped: "off" })) };
    expect(await handleLocationUpdate(HERE, d)).toBe("capped");
    expect(d.release).not.toHaveBeenCalled();
  });
  it("releases the day's claim when another writer holds the lock, so the next event retries", async () => {
    const d = { ...base(), createTodo: vi.fn<NudgeDeps["createTodo"]>(async () => ({ skipped: "locked" })) };
    expect(await handleLocationUpdate(HERE, d)).toBe("capped");
    expect(d.release).toHaveBeenCalledWith(5, "2026-10-18");
  });
  it("ignores locations with no saved place nearby", async () => {
    const d = { ...base(), candidates: vi.fn(async () => [far]) };
    expect(await handleLocationUpdate({ latitude: 43.0418, longitude: -87.9097 }, d)).toBe("none");
  });
});
