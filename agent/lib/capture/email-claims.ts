import { db } from "../db";

export type EmailOutcome = "saved" | "duplicate" | "ignored";

// Resend retries a webhook until it gets a 2xx, so each received email is claimed by its Resend id first.
// Atomic: `on conflict do nothing` lets exactly one delivery through. A claim still 'processing' after the lease is a
// crashed run and may be re-taken; a run that fails releases its own claim so the retry can succeed.
// Only the Resend id, timestamps, outcome and rec id are stored: never the body, subject or addresses.
export const CLAIM_LEASE_MINUTES = 10;

export async function claimEmail(emailId: string): Promise<boolean> {
  const rows = await db()`insert into processed_emails (email_id) values (${emailId})
                          on conflict (email_id) do update set claimed_at = now()
                            where processed_emails.outcome = 'processing'
                              and processed_emails.claimed_at < now() - make_interval(mins => ${CLAIM_LEASE_MINUTES}::int)
                          returning email_id`;
  return rows.length === 1;
}

export async function releaseEmail(emailId: string): Promise<void> {
  await db()`delete from processed_emails where email_id = ${emailId} and outcome = 'processing'`;
}

export async function finishEmail(emailId: string, outcome: EmailOutcome, recId: number | null): Promise<void> {
  await db()`update processed_emails set outcome = ${outcome}, recommendation_id = ${recId}::bigint, processed_at = now()
             where email_id = ${emailId}`;
}
