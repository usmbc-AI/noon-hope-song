// ── AI DJ 음성(TTS) 프록시 — ElevenLabs(직접 만든 DJ 목소리) → OpenAI 폴백 ─────
// 텍스트(방송용 멘트)를 받아 음성(mp3)으로 돌려준다. 키는 서버 환경변수에만.
// ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID 가 있으면 ElevenLabs 목소리로 읽고,
// 없거나 실패하면(한도 초과 등) 기존 OpenAI 프리셋 목소리로 읽는다.
// 어느 쪽이 읽었는지는 응답 헤더 X-TTS-Provider 로 확인 가능.
//
// 요청 (POST /api/tts): { "text": "..." }
// 응답: audio/mpeg (mp3 바이너리)

const DEFAULT_INSTRUCTIONS =
  "너는 정오의 희망곡의 라디오 진행자 '정오'야. 변성기가 오기 전의, 맑고 앳되고 밝은 남자아이 같은 목소리로 말해. " +
  "톤은 높고 청량하지만 과장 없이, 순수하고 정겹게. " +
  "곡 내용이 신나든 슬프든 상관없이 항상 같은 목소리·톤·속도·억양을 일관되게 유지해. 매번 같은 사람이 말하는 것처럼 또박또박 자연스럽게.";

const num = (v, d, lo, hi) => { const n = Number(v); return Math.min(hi, Math.max(lo, Number.isFinite(n) && v !== undefined && v !== "" ? n : d)); };

// ElevenLabs: 목소리 자체가 캐릭터라 지시문(instructions)은 없음.
// ElevenLabs 화면에서 듣는 소리와 같게 하려고:
//  - 모델은 화면 기본값인 eleven_v3 우선, 안 되면 eleven_multilingual_v2 (ELEVENLABS_MODEL 로 지정 가능)
//  - voice_settings 는 보내지 않음 → 목소리에 저장된 설정 그대로. (환경변수로 지정한 값만 덮어씀)
const ELEVEN_MODELS = [...new Set([process.env.ELEVENLABS_MODEL, "eleven_v3", "eleven_multilingual_v2"].filter(Boolean))];

function elevenSettings() {
  const env = process.env, vs = {};
  if (env.ELEVENLABS_STABILITY) vs.stability = num(env.ELEVENLABS_STABILITY, 0.5, 0, 1);          // 높을수록 매번 같은 톤
  if (env.ELEVENLABS_SIMILARITY) vs.similarity_boost = num(env.ELEVENLABS_SIMILARITY, 0.75, 0, 1); // 원래 목소리와의 유사도
  if (env.ELEVENLABS_SPEED) vs.speed = num(env.ELEVENLABS_SPEED, 1.0, 0.7, 1.2);                   // 말 속도(0.7~1.2)
  return Object.keys(vs).length ? vs : null;
}

// 반환: { buf, model }
async function elevenLabs(text, apiKey, voiceId) {
  const voice_settings = elevenSettings();
  let lastErr = "";
  for (const model_id of ELEVEN_MODELS) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id, ...(voice_settings ? { voice_settings } : {}) }),
    });
    if (r.ok) return { buf: Buffer.from(await r.arrayBuffer()), model: model_id };
    lastErr = `ElevenLabs ${model_id} ${r.status}: ${(await r.text()).slice(0, 200)}`;
    console.error("[tts]", lastErr);
  }
  throw new Error(lastErr);
}

async function openAI(text, apiKey, body) {
  const voice = (body && body.voice) || process.env.OPENAI_TTS_VOICE || "alloy";
  const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
  const instructions = (body && body.instructions) || DEFAULT_INSTRUCTIONS;
  const speed = num((body && body.speed) || process.env.OPENAI_TTS_SPEED, 1.2, 0.25, 4);
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: text, voice, instructions, response_format: "mp3", speed }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const elevenKey = process.env.ELEVENLABS_API_KEY, elevenVoice = process.env.ELEVENLABS_VOICE_ID;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!(elevenKey && elevenVoice) && !openaiKey) {
    return res.status(500).json({ error: "TTS 키 미설정 (ELEVENLABS_API_KEY+ELEVENLABS_VOICE_ID 또는 OPENAI_API_KEY)" });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  const text = (body && body.text || "").toString().slice(0, 900);
  if (!text.trim()) return res.status(400).json({ error: "text 필요" });

  const send = (buf, provider, model) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-TTS-Provider", provider);
    if (model) res.setHeader("X-TTS-Model", model);
    return res.end(buf);
  };

  let elevenErr = "";
  if (elevenKey && elevenVoice) {
    try { const o = await elevenLabs(text, elevenKey, elevenVoice); return send(o.buf, "elevenlabs", o.model); }
    catch (e) { elevenErr = String(e.message || e); console.error("[tts] ElevenLabs 실패 → OpenAI 폴백:", elevenErr); }
  }
  if (!openaiKey) return res.status(502).json({ error: "TTS 오류", detail: elevenErr.slice(0, 300) });

  try {
    return send(await openAI(text, openaiKey, body), "openai");
  } catch (e) {
    return res.status(502).json({ error: "TTS 오류", detail: String(e.message || e).slice(0, 300) });
  }
};
