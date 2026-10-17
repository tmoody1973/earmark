// The live bloom, the garden's one authored moment (direction contract: "the plant redraws from its current stage
// to bloom in place — stroke draw, then the single orange flower opens"). Web Animations on an SVG drawn by
// PlantArt with bloomFrom set: only opacity, transform and stroke-dashoffset move, so nothing reflows.
//
//   0–360 ms      the old drawing fades out (its ground line is shared and stays)
//   0–1.1 s       stem, leaves and veins draw in, base first, 70 ms apart
//   1.0–1.7 s     the five petals open from the flower's eye, 60 ms apart; the eye settles last
//
// Dashes under vector-effect: non-scaling-stroke are not in path units (Chromium measures them on screen), so while
// it draws the plant switches to scaled strokes and divides the width by the drawing's scale (--draw-scale, set here):
// the line looks the same before, during and after.

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
export const BLOOM_MS = 1700;
/** When the petals start to open: the card's words and the bloom dot change here, not at t=0. */
export const FLOWER_OPENS_MS = 1000;

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Plays the bloom on `svg`; resolves when every part has landed (or at once when the drawing is not there). */
export async function playBloom(svg: SVGSVGElement): Promise<void> {
  const now = svg.querySelector<SVGGElement>(".plant-now");
  const was = svg.querySelector<SVGGElement>(".plant-was");
  if (!now || !was) return;
  const box = svg.getBoundingClientRect();
  svg.style.setProperty("--draw-scale", String(Math.max(box.width / 80, box.height / 100) || 1)); // viewBox 80×100, slice

  const anims: Animation[] = [was.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 360, easing: EASE, fill: "forwards" })];

  const strokes = [...now.querySelectorAll<SVGGeometryElement>("path, ellipse")].filter((el) => !el.closest(".plant-flower"));
  strokes.forEach((el, i) => {
    const len = el.getTotalLength();
    const dash = `${len} ${len}`;
    anims.push(el.animate(
      [{ strokeDasharray: dash, strokeDashoffset: len }, { strokeDasharray: dash, strokeDashoffset: 0 }],
      { duration: 560, delay: 40 + i * 70, easing: EASE, fill: "backwards" },
    ));
  });

  const petals = [...now.querySelectorAll<SVGPathElement>(".plant-flower .petal, .plant-flower .petal-vein")];
  petals.forEach((el) => {
    const turn = [...el.parentElement!.parentElement!.children].indexOf(el.parentElement!); // which of the five petals
    anims.push(el.animate(
      [{ transform: "scale(0.25)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }],
      { duration: 460, delay: FLOWER_OPENS_MS + turn * 60, easing: EASE, fill: "backwards" },
    ));
  });
  for (const el of now.querySelectorAll<SVGElement>(".plant-flower .flower-eye, .plant-flower .stamen, .plant-flower .anther")) {
    anims.push(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 1350, easing: EASE, fill: "backwards" }));
  }

  await Promise.allSettled(anims.map((a) => a.finished));
}
