import { experimental_decide as decide, generateText, Output } from "ai";
import { z } from "zod";
import { getEnv } from "../env";
import { REC_TYPE_CRITERIA } from "../pipeline/criteria";
import type { RecType } from "../types";
import { photoDecisionModel } from "./photo-model";

export interface PhotoClass {
  itemProbability: number;
  recType: RecType;
  recTypeProbability: number;
  personProbability: number;
}

const ITEM_CRITERIA = {
  a_specific_item:
    "The image shows one specific album, song, artist, book, place, podcast, film, TV show or online video that someone could look up by name: a cover, a spine, a sign, a menu with the restaurant's name, a poster, or a screen with a readable title or name.",
  no_specific_item:
    "The image shows no readable title or name of something to try: scenery, food with no restaurant name, a pet, a blurry photo, or a document unrelated to media or places.",
};

export async function classifyPhoto(
  bytes: Uint8Array,
  mediaType: string,
  decideImpl: typeof decide = decide,
): Promise<PhotoClass> {
  const result = await decideImpl({
    model: await photoDecisionModel(),
    state: [{ type: "file", mediaType, data: bytes }],
    questions: {
      item: { type: "choice", instructions: "What does the image show?", criteria: ITEM_CRITERIA },
      rec_type: {
        type: "choice",
        instructions: "What kind of item is shown in the image? Use `none` if no item is shown.",
        criteria: REC_TYPE_CRITERIA,
      },
      has_person: {
        type: "boolean",
        instructions:
          "Does the image show any person, or any part of a person's face or body? Answer true even if the person is small, blurry, in the background, or only partly visible, such as a hand holding something.",
      },
    },
  });
  const { item, rec_type, has_person } = result.answers;
  const itemP = item.type === "choice" ? item.probabilities?.a_specific_item ?? (item.choice === "a_specific_item" ? 1 : 0) : 0;
  const typeChoice = rec_type.type === "choice" ? String(rec_type.choice) : "none";
  return {
    itemProbability: itemP,
    recType: (typeChoice === "none" ? "other" : typeChoice) as RecType,
    recTypeProbability: rec_type.type === "choice" ? rec_type.probabilities?.[rec_type.choice] ?? 0 : 0,
    // fail closed: a missing person answer counts as "person present"
    personProbability: has_person.type === "boolean" ? has_person.probability : 1,
  };
}

const PhotoReadSchema = z.object({
  title: z.string().describe("Main readable title or name, exactly as printed; empty string if none is readable"),
  creator: z.string().nullable().describe("Artist, author, host, director or channel if printed, else null"),
  visibleText: z.string().max(300).describe("Other printed text, verbatim, at most 300 characters"),
});

const READ_PROMPT =
  "Read this photo for a personal list of recommendations. Copy the main title or name exactly as printed, and the creator if printed. Do not guess anything that is not printed. Never describe people.";

export async function readPhoto(
  bytes: Uint8Array,
  mediaType: string,
  generateImpl: typeof generateText = generateText,
): Promise<z.infer<typeof PhotoReadSchema>> {
  const { output } = await generateImpl({
    model: getEnv().WRITE_MODEL,
    output: Output.object({ schema: PhotoReadSchema }),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: READ_PROMPT },
          { type: "file", mediaType, data: bytes },
        ],
      },
    ],
  });
  return output;
}
