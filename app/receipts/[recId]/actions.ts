"use server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { approveReceipt, chicagoLocalToUtc, deferReceipt, draftReceipt, ReceiptError } from "@/agent/lib/recs/receipts";
import { requireOwner } from "@/app/gardeners/owner";

// Expected refusals (ReceiptError) come back as { error } so the page can show them; anything else is logged with its
// name only (no note text, names or tokens) and shown generically, since Next masks a thrown message in production.
export type ReceiptResult = { error?: string; ok?: string };
const fail = (action: string, id: number, err: unknown): ReceiptResult => {
  console.error(`[receipts] action=${action} id=${id} error=${err instanceof Error ? err.name : "unknown"}`);
  return { error: err instanceof ReceiptError ? err.message : "Something went wrong; try again" };
};

export async function draftAction(recId: number, _prev: ReceiptResult): Promise<ReceiptResult> {
  await requireOwner();
  try {
    await draftReceipt(recId);
  } catch (err) {
    return fail("draft", recId, err);
  }
  revalidatePath(`/receipts/${recId}`);
  return {};
}

export async function approveAction(recId: number, receiptId: number, message: string): Promise<{ url: string } | { error: string }> {
  await requireOwner();
  try {
    const url = await approveReceipt(recId, receiptId, message, after);
    revalidatePath(`/receipts/${recId}`);
    return { url };
  } catch (err) {
    return { error: fail("approve", receiptId, err).error! };
  }
}

export async function deferAction(recId: number, receiptId: number, _prev: ReceiptResult, fd: FormData): Promise<ReceiptResult> {
  await requireOwner();
  try {
    // <input type="datetime-local"> gives Chicago wall time with no zone
    await deferReceipt(receiptId, chicagoLocalToUtc(String(fd.get("when") ?? "")));
  } catch (err) {
    return fail("defer", receiptId, err);
  }
  revalidatePath(`/receipts/${recId}`);
  return { ok: "Reminder set in Bee." };
}
