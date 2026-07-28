// ── 테마 '제목' 검색 프록시 (iTunes songTerm) ────────────────────────
// 테마 단어(예: 더위, 불, 비, 드라이브)가 '곡 제목'에 든 실제 곡을 찾아준다.
// → 오늘 상황과 제목을 재치있게 엮는 '제목 말장난'용 후보 확보.
//
// 요청 (POST /api/theme): { "terms": ["더위","불", ...] }
// 응답: { songs: [ {title,artist,origin:"kr",themeTerm,album,genre,year,artwork,url,tags} ] }

function normKey(s){
  return String(s||"").toLowerCase()
    .replace(/\(.*?\)|\[.*?\]|【.*?】/g,"").replace(/feat.*|with .*|ft\..*/gi,"")
    .replace(/[\s\-_.,'"!?~·・&]/g,"");
}
async function getJSON(url){
  try{ const r=await fetch(url,{headers:{"User-Agent":"noon-hope-song/1.0"}}); if(!r.ok)return null; return await r.json(); }
  catch(_){ return null; }
}
async function mapLimited(items, limit, fn){
  const out=new Array(items.length); let i=0;
  async function w(){ while(i<items.length){ const idx=i++; out[idx]=await fn(items[idx],idx); } }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},w));
  return out;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  const terms = (Array.isArray(body && body.terms) ? body.terms : [])
    .map((t) => String(t || "").trim()).filter(Boolean).slice(0, 4);
  if (!terms.length) return res.status(200).json({ songs: [] });

  const per = await mapLimited(terms, 3, async (term) => {
    const j = await getJSON(
      `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=KR&media=music&entity=song&attribute=songTerm&limit=8&lang=ko_kr`
    );
    return { term, results: (j && j.results) || [] };
  });

  const seen = new Set(); const songs = [];
  per.forEach(({ term, results }) => {
    let added = 0;
    for (const r of results) {
      if (added >= 4) break; // 단어당 최대 4곡
      if (!r.trackName || !r.artistName) continue;
      const k = normKey(r.trackName) + "|" + normKey(r.artistName);
      if (seen.has(k)) continue; seen.add(k);
      songs.push({
        title: r.trackName, artist: r.artistName, origin: "kr", themeTerm: term,
        album: r.collectionName || "", genre: r.primaryGenreName || "", year: (r.releaseDate || "").slice(0, 4),
        artwork: (r.artworkUrl100 || "").replace("100x100", "120x120"), url: r.trackViewUrl || "", tags: [],
      });
      added++;
    }
  });

  res.setHeader("Cache-Control", "s-maxage=3600");
  return res.status(200).json({ songs: songs.slice(0, 12) });
};
