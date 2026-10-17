"use client";
import { useEffect, useRef, useState } from "react";

type Phase = "idle" | "listening" | "thinking" | "speaking";
interface Turn { question: string; answer: string; toolsUsed: string[] }
interface Recognition { lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; start(): void; stop(): void }
type RecognitionCtor = new () => Recognition;

const SORRY = "Sorry, I couldn't reach your garden just now.";
const PHASE_LABEL: Record<Phase, string> = { idle: "Ready", listening: "Listening", thinking: "Thinking", speaking: "Speaking" };

export function Device() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [canListen, setCanListen] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    setCanListen(!!(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);

  function stopSpeaking() {
    audio.current?.pause();
    window.speechSynthesis?.cancel();
  }

  function speak(answer: string, mp3?: string) {
    const done = () => setPhase("idle");
    const browserVoice = () => {
      if (!("speechSynthesis" in window)) return done();
      const u = new SpeechSynthesisUtterance(answer);
      u.onend = done;
      u.onerror = done;
      window.speechSynthesis.speak(u);
    };
    setPhase("speaking");
    if (!mp3) return browserVoice();
    const a = new Audio(`data:audio/mpeg;base64,${mp3}`);
    audio.current = a;
    a.onended = done;
    a.play().catch(browserVoice); // Safari may block autoplay after the await
  }

  async function ask(question: string) {
    const q = question.trim().slice(0, 300);
    if (!q || phase === "thinking") return;
    setText("");
    stopSpeaking();
    setPhase("thinking");
    // Prior turns give the follow-up its context; only the last 6 messages are sent and nothing is stored.
    const history = turns.flatMap((t) => [{ role: "user" as const, text: t.question }, { role: "assistant" as const, text: t.answer }]).slice(-6).map((m) => ({ ...m, text: m.text.slice(0, 600) }));
    try {
      const res = await fetch("/api/alexa-sim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q, history }) });
      if (!res.ok) throw new Error("bad");
      const data = (await res.json()) as { answer: string; toolsUsed: string[]; audio?: string };
      setTurns((t) => [...t, { question: q, answer: data.answer, toolsUsed: data.toolsUsed }]);
      speak(data.answer, data.audio);
    } catch {
      setTurns((t) => [...t, { question: q, answer: SORRY, toolsUsed: [] }]);
      speak(SORRY);
    }
  }

  function listen() {
    if (phase === "listening") return rec.current?.stop();
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    stopSpeaking();
    const r = new Ctor();
    r.lang = "en-US";
    r.interimResults = false;
    let heard = "";
    r.onresult = (e) => { heard = e.results[0]?.[0]?.transcript ?? ""; };
    r.onerror = () => setPhase("idle");
    r.onend = () => (heard ? void ask(heard) : setPhase("idle"));
    rec.current = r;
    setPhase("listening");
    r.start();
  }

  return (
    <section className="device" aria-label="Alexa+ simulator">
      <div className={`ring ring-${phase}`} aria-hidden="true" />
      <p className="phase">{PHASE_LABEL[phase]}</p>
      {canListen && (
        <button type="button" className="mic" onClick={listen} aria-pressed={phase === "listening"} disabled={phase === "thinking"}>
          {phase === "listening" ? "Stop listening" : "Talk to Alexa"}
        </button>
      )}
      <form onSubmit={(e) => { e.preventDefault(); void ask(text); }} className="typed">
        <label htmlFor="alexa-q">{canListen ? "Or type your question" : "Type your question"}</label>
        <input id="alexa-q" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="What did Ann tell me to try this month?" autoComplete="off" />
        <button type="submit" disabled={phase === "thinking" || !text.trim()}>Ask</button>
      </form>
      <div className="turns" aria-live="polite">
        {turns.map((t, i) => (
          <article key={i} className="turn">
            <p className="said"><span>You said</span>{t.question}</p>
            <p className="reply"><span>Alexa said</span>{t.answer}</p>
            {t.toolsUsed.length > 0 && <p className="used">used: {t.toolsUsed.join(", ")}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}
