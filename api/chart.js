// ── Apple Music 한국 차트 프록시 ─────────────────────────────────────
// 브라우저에서 RSS를 직접 fetch하면 CORS로 막힐 수 있어, 서버에서 대신 가져온다.
// 오늘 인기 아티스트 이름 목록을 돌려준다 (곡 풀에 "요즘 뜨는 아티스트"를 반영).
//
// 응답 (GET /api/chart):
//   { "artists": ["aespa","아이유",...], "songs":[{title,artist},...] }

async function chartArtists(country, limit) {
  try {
    const j = await (await fetch(
      `https://rss.applemarketingtools.com/api/v2/${country}/music/most-played/${limit}/songs.json`
    )).json();
    const results = (j && j.feed && j.feed.results) || [];
    return {
      artists: [...new Set(results.map((x) => x.artistName).filter(Boolean))],
      songs: results.map((x) => ({ title: x.name, artist: x.artistName })),
    };
  } catch (e) {
    return { artists: [], songs: [] };
  }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const [kr, us] = await Promise.all([chartArtists("kr", 50), chartArtists("us", 40)]);
  res.setHeader("Cache-Control", "s-maxage=3600"); // 1시간 캐시
  return res.status(200).json({
    artists: kr.artists,       // 국내 인기 아티스트
    popArtists: us.artists,    // 해외 팝 인기 아티스트
    songs: kr.songs,
  });
};
