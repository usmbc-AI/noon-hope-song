// ── AI DJ 목소리(ElevenLabs) 남은 크레딧 조회 ─────────────────────────
// 화면에 "남은 크레딧 / 한도 · 다음 충전일"을 보여주기 위한 프록시. 키는 서버 환경변수에만.
// ※ API 키에 '사용자(User) 읽기' 권한이 있어야 한다. 없으면 { ok:false, reason:"permission" }.
//
// 요청 (GET /api/credits)
// 응답: { ok:true, used, limit, remaining, resetAt(초 단위 유닉스 시각|null), tier }
//       { ok:false, reason: "unconfigured" | "permission" | "error", detail? }

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store"); // 🔊 재생 직후 바로 갱신돼야 하므로 캐시 안 함

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(200).json({ ok: false, reason: "unconfigured" });

  try {
    const r = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": apiKey } });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 200);
      const reason = (r.status === 401 || r.status === 403) ? "permission" : "error";
      return res.status(200).json({ ok: false, reason, detail: `ElevenLabs ${r.status}: ${detail}` });
    }
    const j = await r.json();
    const used = Number(j.character_count), limit = Number(j.character_limit);
    if (!Number.isFinite(used) || !Number.isFinite(limit)) {
      return res.status(200).json({ ok: false, reason: "error", detail: "응답에 크레딧 정보가 없음" });
    }
    return res.status(200).json({
      ok: true, used, limit, remaining: Math.max(0, limit - used),
      resetAt: Number(j.next_character_count_reset_unix) || null,
      tier: j.tier || "",
    });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: "error", detail: String(e.message || e) });
  }
};
