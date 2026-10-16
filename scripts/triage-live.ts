import { triageWindow } from "../agent/lib/pipeline/triage";

// Hand-written windows only (not real transcript text).
const windows = {
  rec: "Unknown: oh you have to try Kopp's frozen custard on Layton\nUnknown: the butter pecan is unreal\nUnknown: okay noted",
  idea: "Unknown: what if we did a Rhythm Lab segment on Milwaukee house music history\nUnknown: like a three-part thing",
  friend: "Unknown: you have to try Kopp's frozen custard, the butter pecan is unreal\nUnknown: oh nice, I'll go this weekend", // expect rec_to_user
  onAir: "Unknown: folks, this next one is from Sault, you need to hear the whole record", // expect rec_by_user
  neither: "Unknown: did you move the car\nUnknown: yeah it's on the street now",
  adRead: "Unknown: this episode is brought to you by BetterHelp. Visit betterhelp dot com slash earmark for ten percent off your first month", // expect broadcast high
  aboutAnAd: "Unknown: did you hear that Culver's ad? we should actually go try the pumpkin custard\nUnknown: yeah let's go Saturday", // expect broadcast low
};

for (const [label, text] of Object.entries(windows)) {
  const r = await triageWindow(text);
  console.log(label, JSON.stringify({ kind: r.kind, p: r.kindProbability, recType: r.recType, joking: r.jokingProbability, broadcast: r.broadcastProbability }));
  const meta = (r.providerMetadata ?? {}) as Record<string, Record<string, unknown> | undefined>;
  console.log(label, "providerMetadata keys", JSON.stringify(Object.keys(meta)));
  const confidence = Object.fromEntries(
    Object.entries(meta).flatMap(([k, v]) => (v && "confidence" in v ? [[k, v.confidence]] : [])),
  );
  console.log(label, "confidence", JSON.stringify(confidence));
  console.log(label, "providerMetadata", JSON.stringify(r.providerMetadata));
}
