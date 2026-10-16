import { db } from "../db";

/** @deprecated recommenders are upserted by buildSaveQueries together with their rec (M1 final review); nothing calls this. */
export async function upsertRecommender(firstName: string): Promise<number> {
  const [row] = await db()`insert into recommenders (first_name, recs_given) values (${firstName}, 1)
                           on conflict (first_name_key) do update set recs_given = recommenders.recs_given + 1
                           returning id`;
  return Number(row!.id);
}
