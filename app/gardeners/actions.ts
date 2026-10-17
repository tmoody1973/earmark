"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/agent/lib/db";
import { decideRun } from "@/agent/lib/gardeners/decide";
import { runGardener, type GardenerRow } from "@/agent/lib/gardeners/run";
import { toUtcSchedule } from "@/agent/lib/gardeners/schedule";
import { requireOwner } from "./owner";

const NewGardener = z.object({
  name: z.string().trim().min(1).max(60),
  task: z.string().trim().min(5).max(500),
  every: z.enum(["week", "month"]),
  weekday: z.coerce.number().int().min(0).max(6),
  day: z.coerce.number().int().min(1).max(27), // 27, not 28: the UTC conversion can roll a day forward
  hourLocal: z.coerce.number().int().min(0).max(23),
  sources: z.array(z.enum(["ideas", "recs", "recommenders"])).min(1),
  needsApproval: z.boolean(),
});

export async function createGardener(fd: FormData): Promise<void> {
  await requireOwner();
  const g = NewGardener.parse({
    name: fd.get("name"), task: fd.get("task"), every: fd.get("every"), weekday: fd.get("weekday") ?? 0,
    day: fd.get("day") ?? 1, hourLocal: fd.get("hourLocal"), sources: fd.getAll("sources"), needsApproval: fd.get("needsApproval") === "on",
  });
  const schedule = toUtcSchedule(
    g.every === "week" ? { every: "week", weekday: g.weekday, hourLocal: g.hourLocal } : { every: "month", day: g.day, hourLocal: g.hourLocal },
    new Date(),
  );
  await db()`
    insert into gardeners (name, task, schedule, sources, needs_approval)
    values (${g.name}, ${g.task}, ${JSON.stringify(schedule)}::jsonb, ${`{${g.sources.join(",")}}`}::text[], ${g.needsApproval})`;
  revalidatePath("/gardeners");
}

export async function setRunStatus(runId: number, status: "approved" | "dismissed"): Promise<void> {
  await requireOwner();
  await decideRun(z.number().int().positive().parse(runId), z.enum(["approved", "dismissed"]).parse(status));
  revalidatePath("/gardeners");
}

export async function runNow(gardenerId: number): Promise<void> {
  await requireOwner();
  const [g] = (await db()`
    select id, name, kind, task, schedule, sources, needs_approval, last_run_at from gardeners where id = ${z.number().int().positive().parse(gardenerId)}`) as GardenerRow[];
  if (g) {
    try {
      await runGardener(g);
    } catch (err) {
      console.error(`[gardeners] run-now failed id=${g.id} err=${err instanceof Error ? err.name : "unknown"}`); // id + error class only
    }
  }
  revalidatePath("/gardeners");
}
