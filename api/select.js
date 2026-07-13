// ── Gemini 선곡 프록시 ───────────────────────────────────────────────
// 오늘의 정보(날짜·계절·절기·날씨)와 "실제 곡 후보 목록(태그 포함)"을 받아,
// Gemini가 무드를 판단해 후보 안에서만 8~10곡을 골라 이유와 함께 돌려준다.
// Gemini 키는 서버 환경변수(GEMINI_API_KEY)에만 존재 → 브라우저에 노출 안 됨.
//
// 요청 (POST /api/select):
//   { "context": { date, dow, season, term, termMeaning, holiday, weather, weatherDetail },
//     "candidates": [ { title, artist, genre, year, tags:[...] }, ... ] }
// 응답:
//   { opening_ment, mood_summary, mood_keywords:[...], songs:[ {title,artist,indie,reason}, ... ] }

// gemini-flash-latest: 항상 최신 Flash를 가리키는 안정적 별칭(신규 키에서도 사용 가능).
// 특정 버전 고정을 원하면 Vercel 환경변수 GEMINI_MODEL 로 덮어쓰기.
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    mood_summary: { type: "STRING" },
    mood_keywords: { type: "ARRAY", items: { type: "STRING" } },
    opening_ment: { type: "STRING" },
    songs: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          artist: { type: "STRING" },
          indie: { type: "BOOLEAN" },
          reason: { type: "STRING" },
        },
        required: ["title", "artist", "reason"],
      },
    },
  },
  required: ["opening_ment", "mood_keywords", "songs"],
};

function buildPrompt(ctx, candidates, kept, need, total) {
  const list = candidates
    .map((c, i) => {
      const tags = (c.tags || []).length ? ` · 태그: ${c.tags.join(", ")}` : "";
      const genre = c.genre ? ` · 장르: ${c.genre}` : "";
      const year = c.year ? ` · ${c.year}` : "";
      const label = c.origin === "pop" ? "[팝]" : (c.indie ? "[인디]" : "[국내]");
      return `${i + 1}. ${label} ${c.title} — ${c.artist}${genre}${year}${tags}`;
    })
    .join("\n");
  const targetMood = Array.isArray(ctx.targetMood) && ctx.targetMood.length
    ? ctx.targetMood.join(", ") : "오늘 날씨와 계절에 맞는 무드";
  kept = Array.isArray(kept) ? kept : [];
  const keptList = kept.map((k, i) => `${i + 1}. ${k.origin === "pop" ? "[팝]" : "[국내]"} ${k.title} — ${k.artist}`).join("\n");
  const keptBlock = kept.length
    ? `\n[이미 확정된 곡 — 다시 고르지 말 것]\n${keptList}\n- 위 확정곡은 그대로 유지됩니다. **확정곡과 같은 아티스트는 절대 넣지 마세요.**`
    : "";

  return `당신은 MBC FM4U 라디오 <정오의 희망곡>의 선곡 담당 작가입니다. 낮 12시, 따뜻하고 희망적인 한낮의 분위기가 이 프로그램의 정체성입니다.

[오늘 정보]
- 날짜: ${ctx.date} ${ctx.dow}
- 계절: ${ctx.season}
- 절기: ${ctx.term} (${ctx.termMeaning})
- 특별한 날: ${ctx.holiday || "없음"}
- 지역: 울산
- 날씨: ${ctx.weather || "정보 없음"}
- 상세: ${ctx.weatherDetail || ""}
- 기상 특보/주의: ${ctx.weatherAlert || "특이사항 없음"}

[오늘의 타깃 무드]
- ${targetMood}
- 이 무드를 최우선 기준으로 삼으세요. **후보에 있어도 오늘 무드와 어긋나는 곡(너무 격렬/침울/생뚱맞은 곡)은 넣지 마세요.** 애매하면 더 잘 맞는 곡으로 대체하세요.
- **기상 특보/주의가 있으면 그 날씨의 정서를 선곡·멘트에 적극 반영하세요.** (예: 폭염→시원하게 식혀줄 곡이나 여름·열정 테마 / 한파→따뜻하게 감싸는 곡 / 호우→빗소리 어울리는 감성곡 / 대설→포근하고 눈 내리는 무드 / 황사·미세먼지→맑고 청량한 곡으로 답답함 환기 / 건조→촉촉하고 편안한 곡 / 태풍급→차분히 위로가 되는 곡)

[당신의 임무]
1) 위 '오늘 정보'를 종합해 오늘의 무드를 한 줄로 판단하세요 (mood_summary).
2) 아래 [후보 곡 목록]에서만 **정확히 ${need}곡**을 고르세요. 목록에 없는 곡은 절대 만들지 마세요.
   - title/artist는 목록에 적힌 그대로(철자·표기 동일) 사용하세요.
   - **서로 다른 아티스트여야 합니다** (한 가수의 곡을 2개 이상 넣지 마세요).${kept.length ? " 확정곡의 아티스트도 피하세요." : ""}
   - **[인디] 표시된 '숨은 명곡'을 2~3곡 반드시 포함하세요.** (차트 밖의 좋은 곡을 발굴하는 것이 DJ의 역량입니다.) 그 곡은 indie:true 로 표시하고, reason에 왜 숨은 명곡인지 살짝 소개하듯 써주세요.
   - 너무 무겁거나 격한 곡은 피하고, 한낮에 어울리게 발라드·미디엄·감성 팝을 적절히 섞으세요.
   - **해외 팝 비율**: 확정곡을 포함한 최종 총 ${total}곡 중 [팝]이 3~4곡이 되도록, 확정곡의 [팝] 개수를 고려해 이번에 고를 [팝] 수를 정하세요.
   - songs에는 **이번에 새로 고른 ${need}곡만** 담으세요 (확정곡은 담지 않음).${keptBlock}

[선곡 이유(reason) — 매우 중요]
- 각 곡의 reason은 반드시 **"오늘의 날씨/계절/절기"와 "그 곡의 장르·아티스트 스타일 태그, 그리고 당신이 아는 그 곡의 실제 분위기"를 연결**해 왜 지금 어울리는지 분명히 설명하세요.
  (예: "습도 높은 오늘 오후엔, 'korean indie·indie pop' 계열의 나른하고 몽롱한 이 곡이 딱이에요.")
- 태그는 주로 아티스트의 장르·스타일을 나타냅니다. 태그와 함께, 당신이 아는 그 곡 자체의 분위기(발라드/미디엄/업템포 등)를 근거로 삼으세요.
- 막연한 감상이 아니라, 근거(태그/장르/곡의 분위기/오늘 날씨)가 드러나는 따뜻한 1~2문장으로.
- opening_ment는 오늘의 기온·하늘·바람·절기를 언급하는 3~4문장의 정겨운 오프닝 멘트로.

[후보 곡 목록] (반드시 이 안에서만 선택)
${list}

지정된 JSON 스키마로만 출력하세요.`;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY 미설정" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  const ctx = (body && body.context) || {};
  const candidates = Array.isArray(body && body.candidates) ? body.candidates.slice(0, 120) : [];
  if (!candidates.length) return res.status(400).json({ error: "candidates 배열 필요" });
  const kept = Array.isArray(body && body.kept) ? body.kept : [];
  const total = Number(body && body.total) || 9;
  const need = Number(body && body.need) || Math.max(1, total - kept.length);

  try {
    const r = await fetch(`${ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(ctx, candidates, kept, need, total) }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(502).json({ error: "Gemini 오류", detail: errText.slice(0, 400) });
    }

    const data = await r.json();
    const text =
      (((data.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text || "").join("") || "";
    let out;
    try {
      out = JSON.parse(text);
    } catch (_) {
      const s = text.indexOf("{"), e = text.lastIndexOf("}");
      out = JSON.parse(text.slice(s, e + 1));
    }
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: "선곡 생성 실패", detail: String(e.message || e) });
  }
};
