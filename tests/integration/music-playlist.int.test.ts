import { generateKeyPairSync, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";

// Decision 065, real Neon `test` branch (TEST_DATABASE_URL, never production): the rec lane's Earmarked playlist step.
// Apple is a fake fetch (no real Apple call); the developer key is generated here. The one music_auth row on the branch
// is saved first and put back after. Every sweep is scoped to this file's rows (onlyIds).
const RUN = String(Date.now() % 1_000_000);
const KEY = randomBytes(32).toString("base64");
const ENV = {
  APPLE_TEAM_ID: "TEAM123456", APPLE_MUSIC_KEY_ID: "KEY1234567", APPLE_MUSIC_STOREFRONT: "us", MUSIC_TOKEN_KEY: KEY,
  APPLE_MUSIC_PRIVATE_KEY: generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }) as string,
};

describe.skipIf(!process.env.TEST_DATABASE_URL)("the Earmarked playlist step on the Neon test branch (decision 065)", () => {
  let pool: Pool;
  let c: PoolClient;
  let savedAuth: Record<string, unknown> | undefined;
  const ids: number[] = [];
  const posted: string[] = []; // song ids sent to the playlist
  let status = 204;
  const apple = vi.fn(async (url: string, init?: RequestInit) => {
    if (status !== 204) return new Response("", { status });
    if (url.endsWith("/tracks")) {
      posted.push(...(JSON.parse(String(init!.body)).data as { id: string }[]).map((d) => d.id));
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  });
  const quiet = { summarize: vi.fn(async () => null), beeSummary: vi.fn(async () => null), embedRecs: vi.fn(async () => 0),
    about: vi.fn(async () => null), extras: vi.fn(async () => ({})), enrich: vi.fn(async () => null), pick: vi.fn(async () => null) };
  const sweep = async () => {
    const { sweepRecLane } = await import("../../agent/lib/recs/lane");
    return sweepRecLane({ ...quiet, env: ENV, appleFetch: apple as unknown as typeof fetch, onlyIds: ids });
  };
  const connect = async () => {
    const { encryptToken } = await import("../../agent/lib/music/crypto");
    await c.query(`insert into music_auth (id, user_token_enc, playlist_id) values (1, $1, 'p.it')
      on conflict (id) do update set user_token_enc = excluded.user_token_enc, playlist_id = excluded.playlist_id`, [encryptToken("it-user-token", KEY)]);
  };
  const addRec = async (o: { type?: string; status?: string; apple?: string | null; enrichment?: string } = {}) => {
    const { rows } = await c.query(
      `insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, source, status, confidence, apple_music_id, enrichment_status)
       values ($1, 'it playlist', 'IT playlist', 'it playlist', now(), 'ambient', $2, 0.9, $3, $4) returning id`,
      [o.type ?? "song", o.status ?? "new", o.apple === undefined ? `9${RUN}${ids.length}` : o.apple, o.enrichment ?? "matched"]);
    ids.push(Number(rows[0].id));
    return Number(rows[0].id);
  };
  const addedAt = async (id: number) => (await c.query(`select added_to_playlist_at from recommendations where id = $1`, [id])).rows[0].added_to_playlist_at;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    c = await pool.connect();
    savedAuth = (await c.query(`select * from music_auth where id = 1`)).rows[0];
    await c.query(`delete from music_auth where id = 1`);
  });

  afterAll(async () => {
    if (!c) return;
    await c.query(`delete from recommendations where id = any($1::bigint[])`, [ids]);
    await c.query(`delete from music_auth where id = 1`);
    if (savedAuth) {
      await c.query(`insert into music_auth (id, user_token_enc, playlist_id, updated_at) values (1, $1, $2, $3)`,
        [savedAuth.user_token_enc, savedAuth.playlist_id, savedAuth.updated_at]);
    }
    await c.query(`delete from sync_cursors where name = 'rec_lane_lease'`);
    c.release();
    await pool.end();
  });

  beforeEach(() => { apple.mockClear(); posted.length = 0; status = 204; });

  it("not signed in: nothing is added, nothing calls Apple, the sweep doesn't error", async () => {
    const song = await addRec();
    expect(await sweep()).toMatchObject({ status: "done", playlistAdds: 0 });
    expect(apple).not.toHaveBeenCalled();
    expect(await addedAt(song)).toBeNull();
    await c.query(`update recommendations set status = 'dismissed' where id = $1`, [song]); // out of the later tests' way
  });

  it("adds a matched song once, never twice, and the tip page says so", async () => {
    await connect();
    const song = await addRec();
    expect(await sweep()).toMatchObject({ playlistAdds: 1 });
    expect(posted).toEqual([`9${RUN}${ids.indexOf(song)}`]);
    expect(await addedAt(song)).not.toBeNull();
    expect(await sweep()).toMatchObject({ playlistAdds: 0 });
    expect(posted).toHaveLength(1);
    const { getTipDetail } = await import("../../agent/lib/garden/tip-detail");
    expect((await getTipDetail(song))?.inPlaylist).toBe(true);
  });

  it("skips cleared, overheard and maybe tips, unmatched ones and artists", async () => {
    await connect();
    const skipped = [
      await addRec({ status: "dismissed" }), await addRec({ status: "composted" }), await addRec({ status: "overheard" }),
      await addRec({ status: "needs_review" }), await addRec({ enrichment: "no_match" }), await addRec({ type: "artist" }),
      await addRec({ apple: null }),
    ];
    expect(await sweep()).toMatchObject({ playlistAdds: 0 });
    expect(posted).toEqual([]);
    for (const id of skipped) expect(await addedAt(id)).toBeNull();
  });

  it("a Shazam capture flows into the playlist through the same lane step, even when the catalogs find nothing", async () => {
    await connect();
    const { handleSongCapture } = await import("../../agent/lib/capture/songs");
    const appleId = `8${RUN}`;
    const res = await handleSongCapture(new Request("https://earmark.test/api/capture/song", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.EARMARK_CAPTURE_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ title: `IT Shazam ${RUN}`, artist: "IT Band", apple_music_url: `https://music.apple.com/us/album/x/1?i=${appleId}` }),
    }), { findConversation: async () => null, afterCreated: () => {} });
    expect(res.status).toBe(201);
    const id = Number(((await res.json()) as { id: number }).id);
    ids.push(id);
    await c.query(`update recommendations set enrich_next_at = now() where id = $1`, [id]);

    const r = await sweep(); // the fake catalogs find nothing: no_match, but Shazam's Apple id is exact
    expect(r).toMatchObject({ playlistAdds: 1 });
    expect(posted).toEqual([appleId]);
    expect(await addedAt(id)).not.toBeNull();
  });

  it("Apple refusing the sign-in marks it revoked, gives the tip back, and the next pass doesn't call Apple", async () => {
    await connect();
    const song = await addRec();
    status = 403;
    expect(await sweep()).toMatchObject({ playlistAdds: 0 });
    expect(apple).toHaveBeenCalledTimes(1);
    expect(await addedAt(song)).toBeNull();
    const { musicState } = await import("../../agent/lib/music/library");
    expect(await musicState()).toBe("no_auth");

    apple.mockClear();
    status = 204;
    await sweep();
    expect(apple).not.toHaveBeenCalled();
  });
});
