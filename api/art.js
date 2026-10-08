// ── 앨범커버 이미지 프록시 ─────────────────────────────────────────────
// 일부 네트워크(회사망·보안 프로그램 등)에서 Apple 이미지 서버(mzstatic.com)가 막혀 커버가 깨짐.
// 브라우저가 직접 못 받으면(onerror) 이 프록시로 다시 요청 → Vercel 서버가 대신 받아 전달.
//
// 요청 (GET /api/art?u=<mzstatic 이미지 URL>) → 이미지 바이너리

module.exports = async (req, res) => {
  const q = new URL(req.url, "http://x").searchParams;
  let u;
  try { u = new URL(q.get("u") || ""); } catch (_) { return res.status(400).json({ error: "u 필요" }); }
  // 아무 주소나 대신 받아주는 열린 프록시가 되지 않도록 Apple 이미지 서버만 허용
  if (u.protocol !== "https:" || !/(^|\.)mzstatic\.com$/.test(u.hostname)) {
    return res.status(400).json({ error: "mzstatic 이미지만 허용" });
  }
  try {
    const r = await fetch(u.toString(), { headers: { "User-Agent": "noon-hope-song/1.0" } });
    if (!r.ok) return res.status(r.status).end();
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=2592000"); // 커버는 안 바뀜 → 길게 캐시
    return res.end(buf);
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
};
