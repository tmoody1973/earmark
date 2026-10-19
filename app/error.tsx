"use client";
import { useEffect, useSyncExternalStore } from "react";

// A calm page when something on a page fails, instead of Next's default. In the judge demo (decision 053) the usual
// cause is a form (new Space, gardeners, a thank-you, publishing) refused by proxy.ts, so it says so; the demo banner
// is on the page in that case.
const noSubscribe = () => () => {};
const bannerShown = () => !!document.querySelector(".demo-banner");

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const demo = useSyncExternalStore(noSubscribe, bannerShown, () => false);
  useEffect(() => {
    console.error("[page] failed", error instanceof Error ? error.name : typeof error); // never the message
  }, [error]);
  return (
    <main className="garden garden-center error-page">
      <h1>Something didn&rsquo;t work</h1>
      <p>{demo ? "This may be the read-only demo: nothing here can be changed." : "Nothing was lost. Try again in a moment."}</p>
      <button type="button" onClick={() => retry()}>Back to the page</button>
    </main>
  );
}
