// ── AI DJ 음성(TTS) 프록시 — OpenAI ──────────────────────────────────
// 텍스트(방송용 멘트)를 받아 음성(mp3)으로 돌려준다. 키는 서버 환경변수에만.
// ※ 지금은 OpenAI 프리셋 목소리(steerable). 추후 ElevenLabs 클론 목소리로 교체 가능.
//
// 요청 (POST /api/tts): { "text": "...", "voice"?: "coral", "instructions"?: "..." }
// 응답: audio/mpeg (mp3 바이너리)

const DEFAULT_INSTRUCTIONS =
  "너는 MBC FM4U 정오의 희망곡의 따뜻하고 다정한 한낮 라디오 DJ야. " +
  "편안하고 정겨운 구어체로, 살짝 미소 띤 느낌으로 자연스럽게 읽어줘. 너무 빠르지 않게, 또박또박.";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "OPENAI_API_KEY 미설정" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  const text = (body && body.text || "").toString().slice(0, 900);
  if (!text.trim()) return res.status(400).json({ error: "text 필요" });

  const voice = (body && body.voice) || process.env.OPENAI_TTS_VOICE || "coral";
  const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
  const instructions = (body && body.instructions) || DEFAULT_INSTRUCTIONS;

  try {
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: text, voice, instructions, response_format: "mp3" }),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: "TTS 오류", detail: t.slice(0, 300) });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.statusCode = 200;
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    return res.end(buf);
  } catch (e) {
    return res.status(500).json({ error: "TTS 실패", detail: String(e.message || e) });
  }
};
