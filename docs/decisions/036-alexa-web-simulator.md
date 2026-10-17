# 036 — We simulate Alexa+ in a web page that talks to Earmark's real MCP server

**Decision:** Instead of an Alexa+ add-on, Earmark ships an owner-only page (`/alexa`) that behaves like an Alexa+ device (ask by voice or typing, hear and read the answer) and whose assistant is a real MCP client of Earmark's own `/api/mcp`.

**Why this came up:** Hackathon entrants do not get Alexa+ developer access (the private `alexa-ai` tooling), so we cannot register a real skill. The rules allow either a working Alexa+ agent or server, or a simulated Alexa+ experience as long as the source is in the repository and the demo video clearly shows it. MCP (Model Context Protocol, the open standard by which assistants call outside tools) is how Alexa+ would reach Earmark, so what matters is proving that path works end to end. If we got this wrong, the demo would show a mock that proves nothing about the server we built in M5-T9.

**Options:**
1. **Web simulator calling the real MCP server (chosen).** A page with a light ring, a mic button and a text box. A server route mints a service pass (decision 031), connects to `/api/mcp` as an MCP client, lets a model call the tools, and returns a short spoken answer. Real cost: it is not Alexa; it shows the server and the experience, not a device in a living room.
2. **Simulator over mocked tool data.** Faster and offline. Real cost: it proves nothing about the MCP server, so the strongest part of the demo would be fake.
3. **Skip Alexa+ and show only Claude calling the MCP server.** Cheapest. Real cost: the voice-assistant story, which is Earmark's point, would not be on screen.

**What we chose and why:** Option 1. Tarik decided on the simulator path; Claude designed it. It reuses the server, token issuer and voice code already built, so the new code is one agent turn and one page. Voice out uses Amazon Polly (Amazon's text-to-speech service) with the same "Ruth" voice as the weekly episode, which sounds closest to Alexa. Voice in uses the browser's Web Speech API (built-in speech recognition, no new dependency); it works in Chrome and Safari, and where it is missing the text box does the job. If Polly is not configured or fails, the page speaks with the browser's own voice. The MCP client is `@ai-sdk/mcp` 2.0.78, the AI SDK's own client, which matches the `ai` 7 we already use. The server negotiates MCP protocol version 2025-11-25 (the newest it supports, and the one the hackathon rules require).

**What we gave up:**
- **It is not a real Alexa+ run.** No Alexa wake word, no Alexa account linking, no check of how Alexa+ itself phrases or times calls. Real-device testing stays a TODO if access ever opens.
- **Browser speech recognition is uneven.** Firefox has none, and Chrome sends the audio to Google for transcription. The text box is the fallback.
- **One extra model call per question** (a fast model, up to four tool steps), paid per use. The page is owner-only and inputs are capped, so cost is bounded.

**How we'll know if this was right:** On the page, asking "What did <friend> tell me to try this month?" lists the MCP tools it used, answers in one to three sentences with a first name and no URL, and plays audio. Server logs for the turn contain only tool names and counts. The demo video shows this working.

**What actually happened:**
