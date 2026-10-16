// Live check of the idea compost through the AI Gateway: extract → embed → Jev cluster choice.
// Hand-written windows only (not real transcript text). Writes nothing to the database.
import { chooseCluster, type ClusterOption } from "../agent/lib/ideas/choose-cluster";
import { embedText } from "../agent/lib/ideas/embed";
import { extractIdea } from "../agent/lib/pipeline/extract";

const windows = {
  first: "Unknown: what if we did a Rhythm Lab segment on Milwaukee house music history\nUnknown: like a three-part thing on the clubs and the DJs",
  sameIdea: "Unknown: I keep thinking about that house music history idea\nUnknown: honestly it could be a podcast series, the Milwaukee clubs from the nineties and who spun there",
  differentIdea: "Unknown: we should start a monthly newsletter for listeners about new local releases\nUnknown: like a roundup of Milwaukee albums that came out that month",
  sameTopicOtherDeliverable: "Unknown: what if we threw a house music dance party at the station\nUnknown: get a couple of local DJs, open it to members",
};

const distance = (a: number[], b: number[]) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
  return 1 - dot / Math.sqrt(na * nb);
};

const first = await extractIdea(windows.first);
const firstVec = await embedText(`${first.title}. ${first.excerpt}`);
const distractor: ClusterOption = { key: "c_2", title: "Apple Music playlist of staff picks", excerpt: "a shared playlist where staff add songs every week", pinned: false };
const options: ClusterOption[] = [{ key: "c_1", title: first.title, excerpt: first.excerpt, pinned: false }, distractor];
console.log("existing idea c_1 title:", first.title);

for (const label of ["sameIdea", "differentIdea", "sameTopicOtherDeliverable"] as const) {
  const ex = await extractIdea(windows[label]);
  const d = distance(firstVec, await embedText(`${ex.title}. ${ex.excerpt}`));
  for (const order of ["fixed", "shuffled", "shuffled"] as const) {
    const r = await chooseCluster(ex, options, { optionOrder: order });
    console.log(label, JSON.stringify({ title: ex.title, cosineDistanceToC1: Number(d.toFixed(3)), order, choice: r.choice, p: r.probability, joins: r.key }));
  }
}
