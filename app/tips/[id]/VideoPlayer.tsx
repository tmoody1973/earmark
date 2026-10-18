"use client";
import { useState, type ReactNode } from "react";

// Nothing from YouTube loads with the page (decision 045): the stored thumbnail (children, the card's own artwork) and a
// Play button. Only a tap puts in the privacy-enhanced (youtube-nocookie.com) player, which then starts playing.
export function VideoPlayer({ videoId, title, children }: { videoId: string; title: string; children: ReactNode }) {
  const [playing, setPlaying] = useState(false);
  if (playing) {
    return (
      <div className="tip-video">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`}
          title={title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );
  }
  return (
    <div className="tip-video">
      {children}
      <button type="button" className="tip-play" onClick={() => setPlaying(true)}>
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M8 5.5v13l10.5-6.5Z" fill="currentColor" />
        </svg>
        Play<span className="visually-hidden"> {title} (loads YouTube)</span>
      </button>
    </div>
  );
}
