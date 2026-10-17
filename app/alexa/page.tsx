import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isOwner } from "@/agent/lib/owner";
import { Device } from "./Device";
import "./alexa.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Alexa+ simulator · Earmark" };

export default async function AlexaPage() {
  const { userId } = await auth();
  if (!isOwner(userId)) notFound();
  return (
    <main className="alexa">
      <p><Link href="/garden">Back to the garden</Link></p>
      <h1>Alexa+ simulator</h1>
      <p className="lede">A stand-in for Alexa+ that asks Earmark&apos;s own MCP server (the open standard assistants use to call tools). Nothing you say is saved.</p>
      <Device />
    </main>
  );
}
