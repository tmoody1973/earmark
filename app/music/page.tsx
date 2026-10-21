import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { isDemo } from "@/agent/lib/demo";
import { musicState } from "@/agent/lib/music/library";
import { appleMusicConfig, getDeveloperToken } from "@/agent/lib/music/developer-token";
import { isOwner } from "@/agent/lib/owner";
import { TabBar } from "../garden/TabBar";
import { ConnectAppleMusic } from "./ConnectAppleMusic";
import "../garden/shell.css";
import "../garden/ideas.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Apple Music · Earmark" };

const SAYS = {
  not_connected: { text: "Not connected yet.", label: "Connect Apple Music" },
  connected: { text: "Connected. Matched songs and albums go to your Earmarked playlist on their own.", label: "Reconnect" },
  no_auth: { text: "Apple Music signed Earmark out, so new music is waiting. Reconnect to pick up where it left off.", label: "Reconnect" },
} as const;

// Owner only (decision 065): proxy.ts refuses strangers first; this is the backstop. The developer token reaches the
// browser only here (MusicKit needs it), signed for 12 hours. The public demo never hands one out.
export default async function MusicPage() {
  const { userId } = await auth();
  if (!isOwner(userId)) notFound();
  const cfg = isDemo() ? null : appleMusicConfig();
  const says = SAYS[isDemo() ? "not_connected" : await musicState()];
  return (
    <>
      <TabBar />
      <main className="garden" id="music">
        <header className="garden-head">
          <h1>Apple Music</h1>
          <p>Sign in once. Songs and albums people recommend then land in a playlist called “Earmarked” in your library. Earmark never plays audio.</p>
        </header>
        <section className="idea-panel" aria-labelledby="music-h">
          <h2 id="music-h">Earmarked playlist</h2>
          <p className="idea-note">{says.text}</p>
          {cfg ? (
            <ConnectAppleMusic developerToken={await getDeveloperToken(cfg)} label={says.label} />
          ) : (
            <p className="idea-quiet">{isDemo() ? "Not available in the demo." : "Apple Music isn’t set up on this server yet."}</p>
          )}
        </section>
      </main>
    </>
  );
}
