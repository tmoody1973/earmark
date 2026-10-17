"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { imageLoadFailed } from "@/agent/lib/garden/cards";

// Artwork URLs come from enrichment and can rot. A failed load swaps to the variant's designed no-image state
// (and drops anything laid over the image, like a map pin), so the shelf never shows a broken image.
// Plain <img>: artwork hosts are open-ended (podcast feeds), so next/image remotePatterns cannot list them;
// every artwork box has a fixed aspect ratio, so nothing shifts while images load.
export function Img({ src, alt, className, width, height, fallback, overlay }: {
  src: string; alt: string; className?: string; width: number; height: number; fallback: ReactNode; overlay?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // An image can fail in the server-rendered HTML before React attaches onError; catch that on mount.
  useEffect(() => {
    if (ref.current && imageLoadFailed(ref.current)) setFailed(true);
  }, []);
  if (failed) return fallback;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- see the note above */}
      <img
        ref={ref}
        src={src}
        alt={alt}
        className={className}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
      {overlay}
    </>
  );
}
