// ── 국내 곡 한글 메타데이터 (pool.js·theme.js 공용, '_'로 시작해 서버리스 함수로 배포되지 않음) ──
// iTunes KR 스토어는 '검색'은 막혔지만(0건/403) 'ID 조회(lookup)'는 동작하고 한글 제목·가수명을 준다.
// US 스토어에서 찾은 국내 곡(The Black Skirts - 1:05)을 KR 조회로 한글화(검정치마 - 한시 오분 (1:05)).

const CHUNK = 150; // lookup은 id를 쉼표로 여러 개 받음

async function localizeKR(items, getJSON){
  const targets = items.filter(s => s.trackId);
  const chunks = [];
  for (let i = 0; i < targets.length; i += CHUNK) chunks.push(targets.slice(i, i + CHUNK));
  const byId = {};
  // 순차 호출(요청 수 최소화 — iTunes 한도 보호)
  for (const c of chunks) {
    const j = await getJSON(`https://itunes.apple.com/lookup?id=${c.map(s => s.trackId).join(",")}&country=KR&lang=ko_kr`);
    ((j && j.results) || []).forEach(r => { if (r.trackId) byId[r.trackId] = r; });
  }
  targets.forEach(s => {
    const r = byId[s.trackId]; if (!r || !r.trackName || !r.artistName) return;
    s.title = r.trackName; s.artist = r.artistName;
    if (r.collectionName) s.album = r.collectionName;
    if (r.primaryGenreName) s.genre = r.primaryGenreName;
    if (r.trackViewUrl) s.url = r.trackViewUrl;
  });
  return items;
}

module.exports = { localizeKR };
