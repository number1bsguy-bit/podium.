// Shared AI-coach logic used by the Vercel function (api/coach.js) and the local server (server.js).
// Sends the transcript + measured voice metrics to Claude and returns structured feedback.

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const MAX_CHARS = 5000;

const SYSTEM = `You are an executive speaking coach. You review a spoken answer to a professional scenario.
You receive a speech-to-text transcript (fillers like "um" may have been dropped by the recognizer) and measured voice metrics.
Be direct, specific and kind. Quote the speaker's exact words when pointing out a problem. Never invent facts about the speaker.
Return ONLY a JSON object, no prose before or after, with this shape:
{
  "score": integer 0-100 (overall articulation and impact),
  "headline": string, max 8 words, the single most important takeaway,
  "strengths": [string, ...] (1-3 items, each one sentence),
  "fixes": [{"quote": exact words from transcript, "issue": short reason, "better": rewritten line}] (1-4 items),
  "delivery": string, one or two sentences interpreting the voice metrics (pace, pauses, pitch variation, volume),
  "model_answer": string, a stronger version of THEIR answer in their voice, same facts, spoken length 20-45 seconds,
  "drill": string, one concrete exercise to do right now (under 30 words),
  "follow_up": string, a realistic follow-up question the other person would ask next
}`;

export async function coach(body = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { status: 503, data: { error: "AI coach is not configured. Set ANTHROPIC_API_KEY on the server." } };

  const access = process.env.ACCESS_CODE;
  if (access && body.accessCode !== access) return { status: 401, data: { error: "Wrong or missing access code. Add it in Settings." } };

  const transcript = String(body.transcript || "").slice(0, MAX_CHARS).trim();
  if (transcript.split(/\s+/).length < 5) return { status: 400, data: { error: "Say a bit more first — the coach needs at least a sentence." } };

  const s = body.scenario || {};
  const m = body.metrics || {};
  const user = [
    `Scenario: ${s.title || "Open practice"}`,
    `Situation: ${s.prompt || "n/a"}`,
    `Suggested structure: ${(s.frame || []).join(" -> ") || "n/a"}`,
    `Speaker's goal: ${body.goal || "career advancement"}`,
    `Language: ${body.lang || "en-US"} (reply in the same language as the transcript)`,
    "",
    "Measured delivery:",
    `- duration ${fmt(m.duration)} s, speaking time ${fmt(m.speakingTime)} s`,
    `- pace ${fmt(m.wpm)} words/min (target 130-160)`,
    `- long pauses (>1.5 s) ${fmt(m.longPauses)}, short pauses ${fmt(m.shortPauses)}`,
    `- pitch variation ${fmt(m.pitchSt)} semitones std (under 2 sounds monotone, 2.5-5 expressive)`,
    `- volume steadiness ${fmt(m.volumeSteady)} / 100`,
    `- fillers detected in transcript ${fmt(m.fillers)}, hedges ${fmt(m.hedges)}`,
    "",
    "Transcript:",
    `"""${transcript}"""`,
  ].join("\n");

  let r;
  try {
    r = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1400, system: SYSTEM, messages: [{ role: "user", content: user }] }),
    });
  } catch (e) {
    return { status: 502, data: { error: "Could not reach the AI service. Check the server's internet connection." } };
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { status: 502, data: { error: j?.error?.message || `AI service returned ${r.status}.` } };

  const text = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  const match = text.match(/\{[\s\S]*\}/);
  try {
    return { status: 200, data: JSON.parse(match ? match[0] : text) };
  } catch {
    return { status: 502, data: { error: "The coach replied in an unexpected format. Try again." } };
  }
}

function fmt(v) { return v === undefined || v === null || Number.isNaN(v) ? "n/a" : Math.round(v * 10) / 10; }
