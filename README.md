# 🎵 정오의 희망곡 — 자동 선곡 웹앱

오늘의 무드(계절·절기·날씨)에 맞는 국내 가요를 자동으로 선곡해 주는 웹앱.
**실제 음원 데이터에서 곡을 모으고, AI가 오늘 무드에 맞춰 고릅니다.** (곡을 지어내지 않음)

## 구조

```
① 후보 곡 풀   iTunes Search — Apple 한국 차트 아티스트 + 에버그린 아티스트의 디스코그래피
                 → 브라우저에서 직접(JSONP), 키 불필요
② 무드 태그    Last.fm — 각 후보 곡의 무드 태그(mellow/chill/rainy day 등)
                 → /api/tags 프록시 경유 (키 숨김)
③ 선곡+이유    Gemini — 오늘 무드 판단 후 후보 안에서 8~10곡 선택 + 이유 작성
                 → /api/select 프록시 경유 (키 숨김)

폴백: ①~③ 중 무엇이든 실패하면 내장 선곡 엔진(라이브러리 기반)으로 자동 전환
```

- `index.html` — 프런트엔드(단일 파일)
- `api/tags.js` — Last.fm 태그 프록시 (서버리스)
- `api/select.js` — Gemini 선곡 프록시 (서버리스)

## 필요한 환경변수

| 이름 | 설명 |
|------|------|
| `GEMINI_API_KEY` | Google AI Studio 발급 키 |
| `LASTFM_API_KEY` | Last.fm API 키 |
| `GEMINI_MODEL` | (선택) 기본 `gemini-2.5-flash` |

> 키는 **서버(프록시)에만** 둡니다. `index.html`에는 절대 넣지 않습니다.

---

## 로컬에서 테스트하기

프록시(서버 함수)가 있어서 `index.html`을 그냥 더블클릭하면 AI 모드가 동작하지 않습니다.
(그 경우 내장 엔진 폴백만 뜹니다.) 전체를 확인하는 방법 두 가지:

### 방법 A. 내장 개발 서버 (가장 간단 · Vercel 로그인 불필요) ✅ 추천
```powershell
node dev-server.js
# → 브라우저에서 http://localhost:3000 접속
```
`dev-server.js` 가 `.env.local` 의 키를 읽어 `/api/*` 를 로컬에서 실행합니다.

### 방법 B. Vercel CLI
```powershell
npm i -g vercel
vercel login
vercel dev        # http://localhost:3000
```

## Vercel에 배포하기

```powershell
# 이 폴더에서
vercel            # 최초 배포(프로젝트 생성). 질문은 대체로 기본값 Enter
vercel --prod     # 운영 배포
```

배포 후 **Vercel 대시보드 → 프로젝트 → Settings → Environment Variables** 에
`GEMINI_API_KEY`, `LASTFM_API_KEY` 를 등록하고 **재배포(`vercel --prod`)** 하세요.
(`.env.local` 은 배포에 올라가지 않습니다.)

> 별도의 `vercel.json` 은 필요 없습니다. Vercel이 `index.html`은 정적 파일로,
> `api/*.js`는 서버리스 함수로 자동 인식합니다.

---

## 보안 메모
- API 키가 채팅/기록에 노출됐다면 발급처에서 **재발급(rotate)** 을 권장합니다.
  - Gemini: https://aistudio.google.com/app/apikey
  - Last.fm: https://www.last.fm/api/accounts
- 키는 `.env.local`(로컬) 또는 Vercel 환경변수(배포)에만 두세요.
