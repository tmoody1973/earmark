import type { CSSProperties } from "react";
import { cardArtwork, spineHue } from "@/agent/lib/garden/cards";
import type { RecCardData } from "@/agent/lib/garden/queries";
import { Icon } from "./icons";
import { Img } from "./Img";

const OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright";

// Image alt text names the thing, not the picture's contents (which we never inspect).
const ALT: Record<RecCardData["variant"], (c: RecCardData) => string> = {
  cover: (c) => `Cover art for ${c.name}${c.creator ? ` by ${c.creator}` : ""}`,
  artist: (c) => c.name,
  spine: (c) => `Cover of ${c.name}`,
  map: (c) => `Photo of ${c.name}`,
  tile: (c) => `Show artwork for ${c.name}`,
  poster: (c) => `Poster for ${c.name}`,
  screen: (c) => `Thumbnail for ${c.name}${c.creator ? ` by ${c.creator}` : ""}`,
  note: (c) => c.name,
};

const GLYPH = { cover: "album", tile: "podcast", map: "place", screen: "video", note: "other" } as const;

/**
 * The designed no-image state for each variant. Decorative (the card body carries the title), so it never prints
 * the title again at equal weight: covers, podcasts, places and videos show their type's glyph on a tinted ground, books
 * and films a quiet spine or poster, and only the artist card sets the name large (it has no other artwork).
 */
function NoImage({ card }: { card: RecCardData }) {
  const { variant, name, creator } = card;
  switch (variant) {
    case "artist":
      return (
        <div className="type-art type-art--artist" aria-hidden="true">
          <span className="type-art-title">{name}</span>
        </div>
      );
    case "spine":
    case "poster":
      return (
        <div className="type-art type-art--stand" aria-hidden="true">
          <div className={variant === "spine" ? "jacket" : "poster"}>
            <span className="type-art-title">{name}</span>
            {creator && <span className="type-art-sub">{creator}</span>}
          </div>
        </div>
      );
    default:
      return (
        <div className="type-art type-art--glyph" aria-hidden="true">
          <Icon name={GLYPH[variant]} size={40} />
        </div>
      );
  }
}

export function Artwork({ card }: { card: RecCardData }) {
  const art = cardArtwork(card);
  const style = { "--hue": spineHue(card.name) } as CSSProperties;
  const fallback = <NoImage card={card} />;
  const box = `rec-art rec-art--${card.variant}`;

  if (art.kind === "map") {
    const { z, x, y, pinX, pinY } = art.tile;
    const overlay = (
      <>
        <span className="rec-pin" style={{ left: `${(pinX / 256) * 100}%`, top: `${(pinY / 256) * 100}%` }} aria-hidden="true">
          <svg width="22" height="28" viewBox="0 0 22 28" focusable="false">
            <path d="M11 27s9-8.2 9-15.5A9 9 0 0 0 2 11.5C2 18.8 11 27 11 27Z" fill="var(--ink)" stroke="var(--surface)" strokeWidth="1.5" />
            <circle cx="11" cy="11.5" r="3.2" fill="var(--surface)" />
          </svg>
        </span>
        <a className="rec-osm" href={OSM_COPYRIGHT}>© OpenStreetMap contributors</a>
      </>
    );
    return (
      <div className={box} style={style}>
        <Img src={`/api/tiles/${z}/${x}/${y}`} alt={`Map showing where ${card.name} is`} className="rec-art-fill"
          width={256} height={256} fallback={fallback} overlay={overlay} />
      </div>
    );
  }

  if (art.kind === "image") {
    const standing = card.variant === "spine" || card.variant === "poster"; // 2:3 objects stand on the ground
    const [width, height] = standing ? [400, 600] : card.variant === "screen" ? [640, 360] : [600, 600];
    return (
      <div className={`${box}${standing ? " rec-art--stand" : ""}`} style={style}>
        <Img src={art.src} alt={ALT[card.variant](card)} className={standing ? "rec-art-object" : "rec-art-fill"}
          width={width} height={height} fallback={fallback} />
      </div>
    );
  }

  return <div className={box} style={style}>{fallback}</div>;
}
