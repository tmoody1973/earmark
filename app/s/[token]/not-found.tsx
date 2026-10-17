import type { Metadata } from "next";
import "@/app/garden/shell.css";
import "./public-space.css";

export const metadata: Metadata = { title: "No longer shared", robots: { index: false, follow: false } };

// A revoked or unknown link: the same polite answer for both, with a 404 status.
export default function SpaceNotShared() {
  return (
    <main className="garden pub-space" id="space">
      <header className="garden-head">
        <h1>This page is no longer shared</h1>
        <p>The link you opened has been turned off. If someone sent it to you, you can ask them for a new one.</p>
      </header>
    </main>
  );
}
