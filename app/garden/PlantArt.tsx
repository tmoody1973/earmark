import type { PlantView } from "@/agent/lib/garden/queries";
import type { PlantLevel } from "@/agent/lib/garden/plant";
import { stageLabel } from "@/agent/lib/garden/plant";

/*
 * The idea plants: hand-authored fine-line botanicals, one per stage, on one 80×100 grid with one ground line, so a
 * plant can redraw from any stage to any other in place (M4-T4 animates it) and never moves its neighbours.
 * Ink only, hairline strokes that stay hairline at any size (vector-effect in ideas.css); the one orange flower opens
 * at bloom, stays through drafted, and is cut and put in a vase once the idea is used. Coordinates are authored by
 * hand: stems lean a little, leaves are asymmetric, each leaf carries its midrib.
 */

// A petal pointing up from the flower's centre, with a soft notch at its tip, and its three veins.
const PETAL = "M0 0C-5.4-2.2-7.6-7.6-5.8-11.4C-4.2-14-1.5-13.5 0-12C1.5-13.5 4.2-14 5.8-11.4C7.6-7.6 5.4-2.2 0 0Z";
const PETAL_VEINS = "M0-2.2V-10.4M-.7-2.8C-2.3-5.2-3.3-7.6-3.6-10M.7-2.8C2.3-5.2 3.3-7.6 3.6-10";
// Five broad petals, a poppy: they overlap at the base and open into gaps at the tips, so each petal reads.
const PETAL_TURNS = [0, 72, 144, 216, 288];
// Stamens: a ring of short filaments with anther dots, read as the flower's eye.
const STAMENS = [20, 70, 120, 165, 215, 260, 310, 350].map((a) => {
  const r = (a * Math.PI) / 180;
  const x = (d: number) => (Math.sin(r) * d).toFixed(2);
  const y = (d: number) => (-Math.cos(r) * d).toFixed(2);
  return { line: `M${x(2)} ${y(2)}L${x(3.6)} ${y(3.6)}`, cx: x(4), cy: y(4) };
});

/** The single orange flower. Face-on, tipped back a little so it reads as a cup on its stem, not a badge. */
function Flower({ x, y, scale = 1, tilt = -14 }: { x: number; y: number; scale?: number; tilt?: number }) {
  return (
    <g className="plant-flower" transform={`translate(${x} ${y}) rotate(${tilt}) scale(${scale} ${scale * 0.86})`}>
      {PETAL_TURNS.map((t) => (
        <g key={t} transform={`rotate(${t})`}>
          <path className="petal" d={PETAL} />
          <path className="petal-vein" d={PETAL_VEINS} />
        </g>
      ))}
      <circle className="flower-eye" r="1.9" />
      {STAMENS.map((s) => (
        <g key={s.line}>
          <path className="stamen" d={s.line} />
          <circle className="anther" cx={s.cx} cy={s.cy} r=".55" />
        </g>
      ))}
    </g>
  );
}

const GROUND = "M12 93.5C26 91.6 54 91.6 68 93.5M23.5 96.4h3.2M44.6 96.9h5M58 95.8h2.4";

/** A leaf as outline + midrib: [outline, midrib]. */
const Leaf = ({ d }: { d: readonly [string, string] }) => (
  <>
    <path className="leaf" d={d[0]} />
    <path className="vein" d={d[1]} />
  </>
);

// Drawn at 1.3× around the ground point: at card size a true-scale seedling disappears.
const SEED = (
  <g transform="translate(40 93) scale(1.3) translate(-40 -93)">
    <path d="M20 93C27 86.4 53 86.4 60 93" />
    <path className="speck" d="M27.8 90.8h1.6M47.4 89.4h2M53 91.4h1.4" />
    <ellipse cx="37.6" cy="90" rx="3.4" ry="2.1" transform="rotate(-18 37.6 90)" />
    <path className="vein" d="M36 91.7C35 93.3 34.5 94.6 33.3 95.6M38.6 92.1C39 93.7 39.9 95 41 96" />
    <path d="M39.7 88.4C40.3 84 40.5 80.6 42 77.6" />
    <Leaf d={["M42 77.6C38.6 76.6 36.6 73.8 36.8 70.8C39.8 71.4 41.8 74 42 77.6Z", "M42 77.6C40.2 75.6 38.6 73.4 37.3 71.3"]} />
    <Leaf d={["M42 77.6C44.4 75 47.4 74.4 49.4 75.6C47.8 78 45 78.6 42 77.6Z", "M42 77.6C44.4 76.4 46.8 75.8 48.9 75.8"]} />
  </g>
);

const SPROUT = (
  <>
    <path d="M30 93C34 90.4 46 90.4 50 93" />
    <path d="M40 92C39.2 84 41.2 75 40 62" />
    <Leaf d={["M40.2 72C35.6 72.6 30.4 70.6 28 66.4C32.8 65.2 37.6 67.4 40.2 72Z", "M40.2 72C36.4 69.8 32 67.6 28.6 66.6"]} />
    <Leaf d={["M40.4 67.4C44 63.8 49.6 62 54 63C51.6 67 45.6 68.8 40.4 67.4Z", "M40.4 67.4C44.6 65.6 49 64 53.4 63.2"]} />
    <Leaf d={["M40 62C38.2 58.6 38.6 55.2 40.6 52.6C42.4 55.4 42.2 58.8 40 62Z", "M40 62C40 58.8 40.2 55.8 40.6 53.2"]} />
    <Leaf d={["M40.2 60.2C42.4 58.4 45 58 46.6 58.8C45.2 60.6 42.8 61 40.2 60.2Z", "M40.2 60.2C42.2 59.4 44.4 59 46.2 58.9"]} />
  </>
);

// Shared by bloom and fruit: the grown stem and its three leaves.
const GROWN = (
  <>
    <path d="M40 93C38.6 80 41.6 64 40.4 50C39.9 45 40.4 40.4 41 36.4" />
    <Leaf d={["M39.6 82C34 82.6 27.4 80 24 74.6C30 73.6 36 76.4 39.6 82Z", "M39.6 82C34.6 79.4 29.4 76.6 24.6 74.8"]} />
    <Leaf d={["M40.6 70C45.6 69.4 51.8 65.6 55.4 59.6C49.4 59.4 43.4 63.2 40.6 70Z", "M40.6 70C45.4 66.6 50.4 62.8 54.8 59.8"]} />
    <Leaf d={["M40.2 55.6C36.6 54.4 33.6 51.4 32.6 47.6C36.4 48 39.2 51 40.2 55.6Z", "M40.2 55.6C37.8 53.2 35.2 50.6 33.1 48"]} />
    <path className="vein" d="M41 36.6C39 36.9 37.4 38.2 36.7 39.6M41 36.6C43.1 36.7 44.6 37.8 45.3 39.2" />
  </>
);

const BLOOM = (
  <>
    {GROWN}
    <Flower x={41.4} y={26.4} />
  </>
);

// Drafted: the same plant a little further on: a side shoot with a closed bud (ink, not a second flower), one more
// leaf, and the flower fully open.
const FRUIT = (
  <>
    {GROWN}
    <path d="M40.3 61.4C45 58.6 49.4 54 52.4 47.6" />
    <path className="leaf" d="M52.4 47.6C49.9 45.2 49.5 40.8 51.9 37.2C54.5 40.6 54.7 45 52.4 47.6Z" />
    <path className="vein" d="M51.9 37.8C51.7 40.6 51.9 43.8 52.4 47.2M52.4 47.4C50.4 46.8 49.4 45.6 49 44.2M52.4 47.4C54.4 47 55.4 45.8 55.8 44.4" />
    <Leaf d={["M40.1 87.4C44.2 86.8 49 84.2 51.4 80C47 79.8 42.8 82.6 40.1 87.4Z", "M40.1 87.4C43.6 85 47.4 82.4 50.9 80.2"]} />
    <Flower x={41.2} y={25.6} scale={1.1} tilt={-10} />
  </>
);

// Used: the idea was cut and put to work: one stem in a small glass bud vase, the waterline and the stem seen
// through the glass.
const HARVESTED = (
  <>
    <path className="vase" d="M33.6 93C30.4 88.6 30 82.4 33 77.6C34.6 75 36.2 73 36.2 69.6V66.6H43.8V69.6C43.8 73 45.4 75 47 77.6C50 82.4 49.6 88.6 46.4 93Z" />
    <ellipse className="vase" cx="40" cy="66.4" rx="4.6" ry="1.1" />
    <path className="vein" d="M32.4 81.2C36.6 82.4 43.4 82.4 47.6 81.2" />
    <path className="vein" d="M40.3 91.4C40.1 84 39.9 76 40 66.6" />
    <path d="M40 65.4C40.6 56 39.2 45 40.8 35.4" />
    <Leaf d={["M40.4 52.4C44.6 50.8 48.8 47 50.4 42C45.6 42.4 41.8 46.2 40.4 52.4Z", "M40.4 52.4C43.6 49.4 46.8 46 49.9 42.3"]} />
    <Leaf d={["M40.1 59.2C37 58.6 34.4 56.2 33.6 53C36.8 53.2 39.2 55.6 40.1 59.2Z", "M40.1 59.2C38.2 57.2 36.2 55.2 34.1 53.4"]} />
    <path className="vein" d="M40.8 35.6C38.8 35.9 37.2 37.2 36.5 38.6M40.8 35.6C42.9 35.7 44.4 36.8 45.1 38.2" />
    <Flower x={41.2} y={25.4} tilt={-8} />
  </>
);

const DRAWINGS: Record<PlantLevel, React.ReactNode> = {
  seed: SEED,
  sprout: SPROUT,
  bloom: BLOOM,
  fruit: FRUIT,
  harvested: HARVESTED,
};

export interface PlantArtProps {
  plant: Pick<PlantView, "id" | "level" | "stage" | "confirmed">;
  size: "sm" | "lg";
  /** Cards say the stage in text, so their plant is decoration; the idea page's plant is labelled. */
  decorative?: boolean;
  /** Live bloom (M4-T4): the level the plant was drawn at. Both drawings share the grid, so the old one fades
   *  while the new one draws over it in place (bloom-motion.ts). Null or absent: the plain drawing. */
  bloomFrom?: PlantLevel | null;
  svgRef?: React.Ref<SVGSVGElement>;
}

export function PlantArt({ plant, size, decorative = false, bloomFrom = null, svgRef }: PlantArtProps) {
  const classes = ["plant", `plant--${size}`, !plant.confirmed && "plant--unconfirmed", plant.stage === "dismissed" && "plant--dismissed"];
  const label = `${stageLabel(plant.stage)} plant${plant.confirmed ? "" : ", unconfirmed"}`;
  return (
    <svg
      ref={svgRef}
      data-bloom-from={bloomFrom ?? undefined}
      className={classes.filter(Boolean).join(" ")}
      viewBox="0 0 80 100"
      preserveAspectRatio="xMidYMax slice"
      data-testid="plant"
      data-cluster-id={plant.id}
      data-level={plant.level}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
      focusable="false"
    >
      <path className="ground" d={GROUND} />
      {bloomFrom ? (
        <>
          <g className="plant-was">{DRAWINGS[bloomFrom]}</g>
          <g className="plant-now">{DRAWINGS[plant.level]}</g>
        </>
      ) : (
        DRAWINGS[plant.level]
      )}
    </svg>
  );
}
