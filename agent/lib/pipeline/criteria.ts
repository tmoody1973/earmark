export const KIND_INSTRUCTIONS =
  "`window` is a few lines of a recorded conversation. Every line is labelled Unknown, so you cannot tell who is speaking; " +
  "decide from the wording. Which option describes `window`?";

// `neither` is first on purpose: Jev leans toward the first option, and a bias toward dropping protects precision.
export const KIND_CRITERIA = {
  neither:
    "Anything else: small talk, logistics, news, questions that do not tell anyone to try a named thing (e.g. 'did you move the car'), " +
    "opinions, complaints, plans and tasks, or a mention of a thing without telling anyone to try it. " +
    "Also: praise of a thing the speaker only mentions about themselves ('I love that album') with no suggestion that anyone try it, " +
    "and telling someone NOT to try a named thing ('don't bother with X', 'skip X'). " +
    "Choose this when the thing is not named or the window is unclear.",
  idea_by_user:
    "A speaker proposes a new idea of their own to make or do: a story, segment, show, newsletter issue, product, feature, " +
    "project or event, often phrased 'what if we…', 'we could do a piece on…', 'an idea for a [segment/story/show/product]…'. " +
    "'We should have [named artist] on the show' is an idea for a segment, not a recommendation. " +
    "Not an idea: errands, chores, scheduling, opinions about something that already exists, or recommending an existing thing.",
  rec_to_user:
    "One person tells another person ('you') to try, hear, read, watch or visit a specific, named thing that already exists: " +
    "an album, song, artist, book, place, podcast, film, show or video — or enthusiastically praises such a named thing to them as worth " +
    "trying ('Kopp's has the best custard in town'). Typical wording: 'you have to try…', 'you'd love…', 'check out…'. " +
    "Also choose this when someone says a named thing was recommended to them ('Dana told me to check out…'). " +
    "The thing must be named in `window`. A general category without a name ('you should read more') does not count. " +
    "'Have you heard X?' counts only when a line also praises X or tells someone to try it.",
  rec_by_user:
    "A speaker recommends a named thing to a broadcast audience or to a group with no single recipient: on-air or listener-facing " +
    "wording ('this next song…', 'listeners, go see…', 'folks, you need to hear…'), or 'everyone should…', 'you all should…'. " +
    "A recommendation to one person who replies is rec_to_user, not this option.",
} as const;

export const REC_TYPE_INSTRUCTIONS = "If `window` recommends a specific named thing, what kind of thing is it?";

export const REC_TYPE_CRITERIA = {
  album: "A whole album, LP, EP or mixtape, named by title or as 'the new [artist] album/record'.",
  song: "A single song or track. If both an album and a song are named, choose the song.",
  artist: "A musician, band, DJ or composer, named with no album, record or song.",
  book: "A book, or an author named as the thing to read.",
  place: "A physical place: restaurant, bar, café, shop, venue, museum, park, neighbourhood or city.",
  podcast: "A podcast or a specific podcast episode.",
  film_tv: "A film, TV series, documentary or a specific episode. A YouTube video or channel is video, not this.",
  video:
    "A video or a channel to watch online, such as a YouTube video, a video essay or a YouTube channel. " +
    "A film or TV show is film_tv, not this. A song's music video counts only when the video itself is the tip " +
    "('you have to watch the video for X'); a tip to hear the song is song.",
  other:
    "Any other specific named thing: a game, app, product, article, newsletter, event, radio show, comedian or visual artist.",
  none: "No specific named thing is recommended in `window`.",
} as const;

export const JOKING_INSTRUCTIONS =
  "Is the speaker clearly joking or being sarcastic when they recommend something or propose an idea in `window`? " +
  "Example: 'you should quit and move to Mars'. A real plan phrased as 'what if we…' is not a joke. " +
  "If nothing is recommended or proposed, the answer is false.";

// true = advertising or broadcast media. Asked in the same decide call as kind/rec_type/joking.
export const BROADCAST_INSTRUCTIONS =
  "Is the audio in `window` an advertisement or a broadcast (radio, podcast or TV) playing from a speaker? " +
  "Answer true for: a sponsor read or ad ('brought to you by', 'use code', 'visit … dot com', '$1 down', a price or promo offer, " +
  "a free trial), a radio station ID or promo (a station name with its frequency, a frequency like '88.9', call letters, " +
  "'you're listening to', 'stay tuned', 'coming up after the break', 'play 889'), or a scripted podcast, radio or TV segment. " +
  "A host reading an ad counts as true. " +
  "A person repeating or quoting a broadcast in conversation is false. " +
  "Answer false when people in the room talk to each other, including when they talk about an ad or something they heard on the radio.";
