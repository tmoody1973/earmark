"use client";
import Script from "next/script";
import { useEffect, useState, useTransition } from "react";
import { connectAppleMusic } from "./actions";

// Apple's own sign-in (MusicKit on the Web v3, from Apple's CDN). The developer token comes from the server page; the
// Music User Token Apple hands back goes straight to the owner-only action, which stores it encrypted. Earmark never plays audio.
// Source: https://js-cdn.music.apple.com/musickit/v3/docs (get started; user authorization).

interface MusicKitInstance { authorize(): Promise<string | undefined>; musicUserToken?: string }
declare global {
  interface Window { MusicKit?: { configure(c: { developerToken: string; app: { name: string; build?: string } }): Promise<MusicKitInstance> } }
}

export function ConnectAppleMusic({ developerToken, label }: { developerToken: string; label: string }) {
  const [ready, setReady] = useState(false);
  const [said, setSaid] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const loaded = () => setReady(true);
    if (window.MusicKit) loaded();
    document.addEventListener("musickitloaded", loaded);
    return () => document.removeEventListener("musickitloaded", loaded);
  }, []);

  const connect = () => {
    setSaid("");
    startTransition(async () => {
      try {
        const music = await window.MusicKit!.configure({ developerToken, app: { name: "Earmark", build: "1.0" } });
        const authorized = await music.authorize();
        const token = authorized || music.musicUserToken;
        if (!token) return setSaid("Apple Music didn’t return a sign-in. Try again.");
        const r = await connectAppleMusic(token);
        setSaid(r.ok ? "Connected. Matched songs and albums go to your Earmarked playlist on the next pass (about 10 minutes)." : r.error);
      } catch (err) {
        console.error("apple music connect failed", (err as Error).name);
        setSaid("The Apple sign-in didn’t finish. Try again.");
      }
    });
  };

  return (
    <div className="pin-row">
      <Script src="https://js-cdn.music.apple.com/musickit/v3/musickit.js" strategy="afterInteractive" />
      <button type="button" className="idea-action" onClick={connect} disabled={!ready || pending}>
        {pending ? "Connecting…" : ready ? label : "Loading Apple Music…"}
      </button>
      <p className="idea-action-status" role="status" aria-live="polite">{said}</p>
    </div>
  );
}
