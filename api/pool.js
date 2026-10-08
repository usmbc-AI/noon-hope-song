// ── 곡 후보 풀 생성 프록시 (서버에서 iTunes 호출) ──────────────────────
// 브라우저가 iTunes를 직접 부르면 기기·네트워크·광고차단·IP제한으로 자주 실패한다.
// 그래서 서버가 대신 수집하고, 결과를 Vercel 엣지에 캐시(s-maxage)해서 iTunes 호출을 드물게 한다.
//
// 응답 (GET /api/pool): { pool: [ {title,artist,origin,indie,chartTop,album,genre,year,artwork,url,tags}, ... ], count }

const MAJOR_EVERGREEN = [
  "아이유","이문세","성시경","폴킴","멜로망스","헤이즈","윤종신","이적","김동률","자이언티",
  "크러쉬","백예린","볼빨간사춘기","10CM","어반자카파","규현","정승환","다비치","이소라","김광석"
];
const INDIE_POOL = [
  "검정치마","혁오","새소년","페퍼톤스","브로콜리너마저","언니네 이발관","장기하와 얼굴들","소란",
  "옥상달빛","ADOY","죠지","카더가든","적재","실리카겔","잔나비","선우정아","쏜애플","김사월",
  "이랑","오지은","이승윤","한로로","프롬","데이브레이크","스탠딩 에그","하림"
];
const POP_ARTISTS = [
  "Bruno Mars","Ed Sheeran","Taylor Swift","Coldplay","Maroon 5","Adele","Sia","Charlie Puth",
  "Sam Smith","John Mayer","Jason Mraz","Norah Jones","Michael Bublé","Olivia Rodrigo","Dua Lipa",
  "Sabrina Carpenter","Lauv","OneRepublic","Christina Perri","Jack Johnson","Corinne Bailey Rae","Bruno Major",
  "Colbie Caillat","Sara Bareilles","Shawn Mendes","Daniel Caesar","HONNE","Rex Orange County"
];
const INDIE_SET = new Set(INDIE_POOL);
const { localizeKR } = require("./_kr.js");

function mulberry32(seed){return function(){let t=seed+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function normKey(s){
  return String(s||"").toLowerCase()
    .replace(/\(.*?\)|\[.*?\]|【.*?】/g,"").replace(/feat.*|with .*|ft\..*/gi,"")
    .replace(/[\s\-_.,'"!?~·・&]/g,"");
}
async function mapLimited(items, limit, fn){
  const out=new Array(items.length); let i=0;
  async function w(){ while(i<items.length){ const idx=i++; out[idx]=await fn(items[idx],idx); } }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},w));
  return out;
}
async function getJSON(url){
  try{
    const ctl=new AbortController(); const to=setTimeout(()=>ctl.abort(),8000); // 8초 넘으면 포기(빌드 지연 방지)
    const r=await fetch(url,{headers:{"User-Agent":"noon-hope-song/1.0"}, signal:ctl.signal});
    clearTimeout(to);
    if(!r.ok)return null; return await r.json();
  }catch(_){ return null; }
}
// ※ iTunes 한국(KR) 스토어는 음악 검색이 0건/403을 반환함(2026-10 확인) → 국내 가수도 US 스토어에서 검색.
//   US 스토어에도 국내 음원이 있고, 한글 검색어(아이유·검정치마 등)도 잘 찾음. 단 가수명이 영문으로 올 수 있음(검정치마→The Black Skirts).
function itunesArtist(a, lang){
  return getJSON(`https://itunes.apple.com/search?term=${encodeURIComponent(a)}&country=US&media=music&entity=song&attribute=artistTerm&limit=25&lang=${lang}`);
}
function itunesTerm(term){
  return getJSON(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=US&media=music&entity=song&limit=2&lang=ko_kr`);
}
async function chartFeed(country, limit){
  const j=await getJSON(`https://rss.applemarketingtools.com/api/v2/${country}/music/most-played/${limit}/songs.json`);
  const results=(j&&j.feed&&j.feed.results)||[];
  return { artists:[...new Set(results.map(x=>x.artistName).filter(Boolean))], songs:results.map(x=>({title:x.name,artist:x.artistName})) };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  // 날짜(KST) 시드로 매일 다른 아티스트 조합
  const nowKst = new Date(Date.now() + 9*3600*1000);
  const doy = Math.floor((Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate()) - Date.UTC(nowKst.getUTCFullYear(),0,0))/864e5);
  const rnd = mulberry32(nowKst.getUTCFullYear()*1000 + doy + 7);
  const shuffle = arr => { const a=(arr||[]).slice(); for(let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };

  const [krC, usC] = await Promise.all([chartFeed("kr",50), chartFeed("us",40)]);

  // 국내 42명(차트27+메이저5+인디10) + 해외 팝 18명(차트10+에버그린8) = 총 60명 (다양성↑)
  const krArtists = [...new Set([...shuffle(krC.artists).slice(0,27), ...shuffle(MAJOR_EVERGREEN).slice(0,5), ...shuffle(INDIE_POOL).slice(0,10)])].slice(0,42);
  const popArtists = [...new Set([...shuffle(usC.artists).slice(0,10), ...shuffle(POP_ARTISTS).slice(0,8)])].slice(0,18);

  const seen=new Set(); let pool=[];
  // queried: 검색에 쓴 가수명 목록(인디 판정용 — 결과 가수명은 영문일 수 있어서 검색어 기준으로 판정)
  const collect=(dataArr, origin, queried)=>{
    dataArr.forEach((d,i)=>{
      const indie = origin!=="pop" && INDIE_SET.has(queried[i]);
      const results=(d&&d.results)||[];
      // US 스토어 가수 검색은 느슨해서(BESTie→Bestion 등) 엉뚱한 가수가 섞임 → 결과 중 최다 artistId(=검색한 가수)의 곡과 그 가수가 참여한 곡만 남김
      const cnt={}; results.forEach(r=>{ if(r.artistId) cnt[r.artistId]=(cnt[r.artistId]||0)+1; });
      const mainId=Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a])[0];
      const mainName=normKey((results.find(r=>String(r.artistId)===mainId)||{}).artistName);
      results.forEach(r=>{
        if(!r.trackName||!r.artistName)return;
        if(mainId && String(r.artistId)!==mainId && !(mainName && normKey(r.artistName).includes(mainName)))return;
        const k=normKey(r.trackName)+"|"+normKey(r.artistName);
        if(seen.has(k))return; seen.add(k);
        pool.push({
          title:r.trackName, artist:r.artistName, origin, trackId:r.trackId,
          indie: indie || (origin!=="pop" && INDIE_SET.has(r.artistName)),
          album:r.collectionName||"", genre:r.primaryGenreName||"", year:(r.releaseDate||"").slice(0,4),
          artwork:(r.artworkUrl100||"").replace("100x100","120x120"), url:r.trackViewUrl||"", tags:[]
        });
      });
    });
  };
  collect(await mapLimited(krArtists,6,a=>itunesArtist(a,"ko_kr")), "kr", krArtists);
  collect(await mapLimited(popArtists,6,a=>itunesArtist(a,"en_us")), "pop", popArtists);

  // 현재 인기차트 상위곡(아이돌 히트) 확보 — 최소 1곡 보장용
  const topSongs=(krC.songs||[]).slice(0,6);
  const topData=await mapLimited(topSongs,3,s=>itunesTerm(s.artist+" "+s.title));
  const topKeys=new Set();
  topData.forEach(d=>{
    const r=((d&&d.results)||[])[0]; if(!r||!r.trackName||!r.artistName)return;
    const k=normKey(r.trackName)+"|"+normKey(r.artistName); topKeys.add(k);
    if(!seen.has(k)){ seen.add(k); pool.push({
      title:r.trackName, artist:r.artistName, origin:"kr", trackId:r.trackId, chartTop:true, indie:false,
      album:r.collectionName||"", genre:r.primaryGenreName||"", year:(r.releaseDate||"").slice(0,4),
      artwork:(r.artworkUrl100||"").replace("100x100","120x120"), url:r.trackViewUrl||"", tags:[]
    }); }
  });
  pool.forEach(p=>{ if(topKeys.has(normKey(p.title)+"|"+normKey(p.artist))) p.chartTop=true; });

  // 국내 곡은 KR 스토어 ID 조회로 한글 제목·가수명으로 교체 (US 스토어는 영문으로 줌)
  await localizeKR(pool.filter(p=>p.origin==="kr"), getJSON);
  const dedup=new Set();
  pool = pool.filter(p=>{
    const k=normKey(p.title)+"|"+normKey(p.artist); if(dedup.has(k))return false; dedup.add(k);
    if(p.origin==="kr" && INDIE_SET.has(p.artist)) p.indie=true;
    return true;
  });

  if(pool.length>=12){
    res.setHeader("Cache-Control","s-maxage=21600, stale-while-revalidate=86400"); // 6시간 엣지 캐시
  }else{
    res.setHeader("Cache-Control","s-maxage=60"); // 실패 시 짧게(곧 재시도)
  }
  return res.status(200).json({ pool, count: pool.length });
};
