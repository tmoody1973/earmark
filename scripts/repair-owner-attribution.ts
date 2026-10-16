// One-off repair: un-credit recommendations attributed to the garden owner (EARMARK_OWNER_FIRST_NAME), then drop the
// owner's recommender row once nothing references it. One transaction; prints counts only. Safe to re-run (0 the second time).
import { db } from "../agent/lib/db";
import { ownerFirstName } from "../agent/lib/env";
import { firstNameOnly } from "../agent/lib/pipeline/attribution";

const raw = ownerFirstName();
const owner = raw ? firstNameOnly(raw).toLowerCase() : "";
if (!owner) throw new Error("EARMARK_OWNER_FIRST_NAME is not set");

const sql = db();
const [updated, deleted] = await sql.transaction([
  sql`update recommendations set recommender_id = null, attribution_source = 'none'
      where recommender_id in (select id from recommenders where first_name_key = ${owner})
      returning id`,
  sql`delete from recommenders p
      where p.first_name_key = ${owner}
        and not exists (select 1 from recommendations r where r.recommender_id = p.id)
      returning p.id`,
]);
console.log({ recommendationsUpdated: updated.length, recommenderRowsDeleted: deleted.length });
if (updated.length === 0) console.warn("warning: 0 recommendations updated (already repaired, or the owner name matches no recommender)");
