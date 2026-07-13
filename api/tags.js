// ── Last.fm 태그 프록시 ──────────────────────────────────────────────
// 웹앱에서 후보 곡 목록을 받아, 각 곡에 무드/장르/스타일 태그를 붙여 돌려준다.
// ※ Last.fm의 "트랙별" 태그는 한국곡에 거의 비어 있어, "아티스트별" 태그를 사용한다.
//    (아티스트당 1회만 호출 → 빠르고 캐시 효율이 좋음. 같은 아티스트 곡은 동일 태그.)
// Last.fm API 키는 서버 환경변수(LASTFM_API_KEY)에만 존재 → 브라우저에 노출 안 됨.
//
// 요청 (POST /api/tags):
//   { "tracks": [ { "artist": "아이유", "title": "밤편지" }, ... ] }
// 응답:
//   { "tags": { "아이유|밤편지": ["k-pop","korean","ballad"], ... } }

const LASTFM = "https://ws.audioscrobbler.com/2.0/";

// 선곡에 쓸모없는 노이즈성 태그 제외
const TAG_STOP = new Set([
  "seen live", "favorite", "favourites", "favorites", "love", "favourite",
  "spotify", "under 2000 listeners", "beautiful", "awesome", "my music",
  "female vocalists", "male vocalists", "female vocals", "male vocals", "vocalists",
]);

function keyOf(artist, title) {
  return `${artist}|${title}`;
}
function norm(s) {
  return String(s || "").toLowerCase().replace(/[\s\-_.]/g, "");
}

async function artistTopTags(artist, apiKey) {
  const url =
    `${LASTFM}?method=artist.gettoptags` +
    `&artist=${encodeURIComponent(artist)}` +
    `&autocorrect=1&api_key=${apiKey}&format=json`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "noon-hope-song/1.0" } });
    if (!r.ok) return [];
    const j = await r.json();
    const raw = (j && j.toptags && j.toptags.tag) || [];
    const na = norm(artist);
    return raw
      .map((t) => String(t.name || "").toLowerCase().trim())
      .filter((n) => n && !TAG_STOP.has(n) && n.length <= 24 && norm(n) !== na)
      .slice(0, 6);
  } catch (_) {
    return [];
  }
}

async function mapLimited(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "LASTFM_API_KEY 미설정" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  const tracks = Array.isArray(body && body.tracks) ? body.tracks.slice(0, 100) : [];
  if (!tracks.length) return res.status(400).json({ error: "tracks 배열 필요" });

  // 아티스트 단위로 중복 제거 후 태그 조회 (효율)
  const uniqArtists = [...new Set(tracks.map((t) => t.artist || ""))].filter(Boolean);
  const perArtist = await mapLimited(uniqArtists, 8, (a) => artistTopTags(a, apiKey));
  const tagByArtist = {};
  uniqArtists.forEach((a, i) => { tagByArtist[a] = perArtist[i]; });

  const tags = {};
  tracks.forEach((t) => { tags[keyOf(t.artist, t.title)] = tagByArtist[t.artist] || []; });

  res.setHeader("Cache-Control", "s-maxage=86400");
  return res.status(200).json({ tags });
};
