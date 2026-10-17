export const KIND_INSTRUCTIONS =
  "`window` is a few lines of a recorded conversation. Every line is labelled Unknown, so you cannot tell who is speaking; " +
  "decide from the wording. Which option describes `window`?";

// `neither` is first on purpose: Jev leans toward the first option, and a bias toward dropping protects precision.
export const KIND_CRITERIA = {
  // M2-T10: the work-talk boundary cases below are synthetic, written from the pattern of the eval's misses (never real text).
  neither:
    "Anything else: small talk, logistics, news, questions that do not tell anyone to try a named thing (e.g. 'did you move the car'), " +
    "opinions, complaints, plans and tasks, or a mention of a thing without telling anyone to try it. " +
    "Work talk is neither: describing, discussing, praising, building, testing or using a named company, publication, website, " +
    "tool, app or product while working, status updates, goals, strategy and planning remarks. Naming a thing is not recommending it. " +
    "Examples that are neither: 'we exported the chart from Datawrapper'; 'the Slack integration broke again'; " +
    "'I built the prototype in Figma, it's awesome'; 'our numbers on Spotify were up this month'; 'we need to reach a younger audience'. " +
    "Also neither: sponsor or underwriting messages, station promos, 'subscribe to my channel', " +
    "praise of a thing the speaker only mentions about themselves ('I love that album') with no suggestion that anyone try it, " +
    "and telling someone NOT to try a named thing ('don't bother with X', 'skip X'). " +
    "Choose this when the thing is not named or the window is unclear.",
  idea_by_user:
    "A speaker proposes a new idea of their own to make or do: a story, segment, show, newsletter issue, product, feature, " +
    "project or event, often phrased 'what if we…', 'we could do a piece on…', 'an idea for a [segment/story/show/product]…'. " +
    "The proposal must say what would be made or done ('we could do a segment on Milwaukee's taco trucks'). " +
    "'We should have [named artist] on the show' is an idea for a segment, not a recommendation. " +
    "Not an idea: describing, testing or giving a status update on something already being built; goals and strategy without " +
    "a specific thing to make ('we need to grow the audience', 'we should test whether people engage more'); errands, chores, " +
    "scheduling, opinions about something that already exists, or recommending an existing thing.",
  rec_to_user:
    "One person tells or urges another person ('you') to try, hear, read, watch, visit, go to or buy a specific, named thing " +
    "that already exists, for their own use or enjoyment: an album, song, artist, book, place, podcast, film, show, app or product " +
    "— or enthusiastically praises such a named thing to them as worth trying ('Kopp's has the best custard in town'). " +
    "Typical wording: 'you have to try…', 'you'd love…', 'check out…', 'you should read…'. " +
    "Also choose this when someone says a named thing was recommended to them ('Dana told me to check out…'). " +
    "The thing must be named in `window`. A general category without a name ('you should read more') does not count. " +
    "'Have you heard X?' counts only when a line also praises X or tells someone to try it. " +
    "Not this option: naming or praising a tool, company or product while talking about work, with no line telling the listener " +
    "to try it themselves ('we exported the chart from Datawrapper' is neither; 'you should make your charts in Datawrapper' is this option), " +
    "and a host, presenter or ad speaking to listeners or viewers.",
  rec_by_user:
    "A speaker recommends a named thing to a broadcast audience or to a group with no single recipient: on-air, listener-facing " +
    "or presenter-style wording ('this next song…', 'listeners, go see…', 'folks, you need to hear…', " +
    "'if you shoot video, you'll want to see this'), or 'everyone should…', 'you all should…'. " +
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
  film_tv: "A film, TV series, documentary or a specific episode.",
  other:
    "Any other specific named thing: a game, app, product, article, newsletter, event, radio show, YouTube channel, comedian or visual artist.",
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
