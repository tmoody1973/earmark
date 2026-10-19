export const KIND_INSTRUCTIONS =
  "`window` is a few lines of a recorded conversation. Every line is labelled Unknown, so you cannot tell who is speaking; " +
  "decide from the wording. Which option describes `window`?";

// `neither` is first on purpose: Jev leans toward the first option, and a bias toward dropping protects precision.
export const KIND_CRITERIA = {
  // M2-T10: the work-talk boundary cases below are synthetic, written from the pattern of the eval's misses (never real text).
  neither:
    "Anything else: small talk, logistics, news, questions that do not tell anyone to try a named thing (e.g. 'did you move the car'), " +
    "opinions, complaints, plans and tasks, or a mention of a thing without telling anyone to try it. " +
    "Talking about work is neither: describing, discussing, praising, building, testing or using a named company, publication, " +
    "website, tool, app or product while talking about work; status updates; goals, strategy and planning remarks. " +
    "Naming a thing is not recommending it. But at work too, a proposal naming what to make or air is idea_by_user, not neither, " +
    "and telling someone to try a named thing for themselves is rec_to_user. " +
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
    "that already exists, for their own use or enjoyment: an album, song, artist, book, place, podcast, film, show, video, app or product " +
    "— or enthusiastically praises such a named thing to them as worth trying ('Kopp's has the best custard in town'). " +
    "Typical wording: 'you have to try…', 'you'd love…', 'check out…', 'you should read…'. " +
    "Also choose this when someone says a named thing was recommended to them ('Dana told me to check out…'). " +
    "A recommendation at work counts like any other: a colleague saying 'you have to try the new ramen place' is this option. " +
    "The thing must be named in `window`. A general category without a name ('you should read more') does not count. " +
    "'Have you heard X?' counts only when a line also praises X or tells someone to try it. " +
    "Not this option: naming or praising a tool, company or product while talking about work, with no line telling the listener " +
    "to try it themselves ('we exported the chart from Datawrapper' is neither; 'you should make your charts in Datawrapper' is this option), " +
    "and a host, presenter or ad speaking to listeners or viewers.",
  rec_by_user:
    "A speaker recommends a named thing to a broadcast audience or to a group with no single recipient: on-air, listener-facing " +
    "or presenter-style wording ('this next song…', 'listeners, go see…', 'folks, you need to hear…', " +
    "'everyone watching, you'll want to see this'), or 'everyone should…', 'you all should…'. " +
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
  // Add-on (video tips): the boundary examples below are synthetic, written for Jev's literal reading (decision 009).
  film_tv:
    "A film, TV series, documentary or a specific episode, on any screen or service. " +
    "A YouTube video, a TikTok or a short clip is video, not this.",
  video:
    "A video or a channel to watch online: a YouTube video or channel, a TikTok, a video essay or a short clip. " +
    "Examples that are video: 'watch this YouTube video about bridges'; 'you have to see this TikTok'; " +
    "'check out that clip of the cat playing piano'. " +
    "A film or TV series is film_tv, even when it streams online ('you should watch Severance' is film_tv). " +
    "A full-length documentary or film is film_tv, even on YouTube; a clip, vlog or video essay is video. " +
    "A video the speaker made, or one merely mentioned, is not a tip: choose none unless someone is told to watch it. " +
    "A podcast is podcast, even when it is filmed ('listen to the latest Hard Fork' is podcast). " +
    "A song's music video is video only when the video itself is the tip ('you have to watch the video for X'); " +
    "a tip to hear the song is song.",
  other:
    "Any other specific named thing: a game, app, product, article, newsletter, event, radio show, comedian or visual artist.",
  none: "No specific named thing is recommended in `window`.",
} as const;

export const JOKING_INSTRUCTIONS =
  "Is the speaker clearly joking or being sarcastic when they recommend something or propose an idea in `window`? " +
  "Example: 'you should quit and move to Mars'. A real plan phrased as 'what if we…' is not a joke. " +
  "If nothing is recommended or proposed, the answer is false.";

// Deliberate earmarks only (decision 049, piece 3): asked in the same decide call, never for ambient windows.
// The examples are synthetic (invented names).
export const CORRECTION_INSTRUCTIONS =
  "Is the speaker in `window` correcting a tip Earmark saved earlier: saying its name, artist or kind is wrong or was " +
  "misheard, and giving the right one? True for: 'that Velvet Moth tip should be Velvet Mouth'; 'the Corla Pine album is " +
  "actually Glass Harbor by Mara Vell'; 'not Kawa Raymond, it's Kawa Ramen'. False for a new recommendation or idea, " +
  "even one that names or praises a thing ('you have to try Kawa Ramen'), and for correcting anything that is not a saved tip.";

// true = advertising or broadcast media. Asked in the same decide call as kind/rec_type/joking.
export const BROADCAST_INSTRUCTIONS =
  "Is the audio in `window` an advertisement or a broadcast (radio, podcast or TV) playing from a speaker? " +
  "Answer true for: a sponsor read or ad ('brought to you by', 'use code', 'visit … dot com', '$1 down', a price or promo offer, " +
  "a free trial), a radio station ID or promo (a station name with its frequency, a frequency like '88.9', call letters, " +
  "'you're listening to', 'stay tuned', 'coming up after the break', 'play 889'), or a scripted podcast, radio or TV segment. " +
  "Also true for an online video or stream playing (YouTube, TikTok, Instagram, a livestream), an audiobook, or song lyrics: " +
  "one voice talking to an audience rather than to someone in the room ('hey guys', 'welcome back to the channel', " +
  "'smash that like button', 'link in the description', 'in today's video', 'let me know in the comments'), " +
  "a product demo or review, or a recipe or how-to walkthrough. " +
  "A host reading an ad counts as true. " +
  "A person repeating or quoting a broadcast in conversation is false. " +
  "Answer false when people in the room talk to each other, including when they talk about an ad or something they heard on the radio.";
