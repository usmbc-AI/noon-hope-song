#!/usr/bin/env bash
# ── AI DJ 목소리(ElevenLabs) 키·목소리 ID를 Vercel 운영 환경변수에 등록하고 재배포 ──
#   사용법:  ./scripts/set-elevenlabs.sh
#   - 키는 화면에 표시되지 않게 입력받고, 명령줄 인자 대신 표준입력으로 Vercel에 전달합니다.
#   - 등록 전에 ElevenLabs에 짧은 문장("테스트")을 실제로 읽혀서 키·목소리 ID가 맞는지 확인합니다(몇 글자분 크레딧 사용).
#   - 필요: Vercel CLI 로그인(vercel login) + 이 폴더가 프로젝트에 연결(vercel link)되어 있을 것.
set -euo pipefail
cd "$(dirname "$0")/.."

PROD_URL="https://noon-hope-song.vercel.app"

if ! command -v vercel >/dev/null; then
  echo "✗ Vercel CLI가 없습니다:  npm i -g vercel"; exit 1
fi
if ! vercel whoami >/dev/null 2>&1; then
  echo "✗ Vercel 로그인이 필요합니다:  vercel login"; exit 1
fi
if [ ! -f .vercel/project.json ]; then
  echo "✗ 프로젝트 연결이 필요합니다:  vercel link --project noon-hope-song"; exit 1
fi

echo "ElevenLabs 키와 목소리 ID를 입력하세요. (키는 입력해도 화면에 표시되지 않습니다)"
read -r -s -p "  ElevenLabs API 키 (sk_로 시작): " KEY; echo
read -r -p "  목소리 ID: " VOICE

KEY="$(printf %s "$KEY" | tr -d '[:space:]')"
VOICE="$(printf %s "$VOICE" | tr -d '[:space:]')"
if [ -z "$KEY" ] || [ -z "$VOICE" ]; then echo "✗ 키와 목소리 ID를 모두 입력해야 합니다."; exit 1; fi
case "$VOICE" in sk_*) echo "✗ 목소리 ID 칸에 API 키가 들어간 것 같아요. 순서를 확인해 주세요."; exit 1;; esac

echo "→ ElevenLabs에 시험 음성을 요청해 키·목소리 ID를 확인하는 중…"
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
CODE="$(curl -s -o "$TMP" -w '%{http_code}' \
  -H @<(printf 'xi-api-key: %s\nContent-Type: application/json\n' "$KEY") \
  -d '{"text":"테스트","model_id":"eleven_multilingual_v2"}' \
  "https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128")"
if [ "$CODE" != "200" ]; then
  echo "✗ 확인 실패 (HTTP $CODE). Vercel에는 아무것도 바꾸지 않았습니다."
  head -c 300 "$TMP"; echo
  echo "  401 → 키가 틀렸거나 '텍스트 음성 변환' 권한이 없음 / 404 → 목소리 ID가 틀림"
  exit 1
fi
echo "✓ 키·목소리 ID 정상"

add_env() { # 이름 값 — 같은 이름이 있으면 덮어씀, 값은 표준입력으로 전달(Secret)
  printf %s "$2" | vercel env add "$1" production --force --sensitive >/dev/null 2>&1 \
    || { echo "✗ $1 등록 실패"; exit 1; }
  echo "✓ $1 등록"
}
add_env ELEVENLABS_API_KEY "$KEY"
add_env ELEVENLABS_VOICE_ID "$VOICE"

# 이름 칸에 키가 잘못 들어간 변수(sk_…) 정리
for NAME in $(vercel env ls production 2>/dev/null | awk '{print $1}' | grep -E '^sk_' || true); do
  read -r -p "  이름이 API 키처럼 생긴 잘못된 변수(${NAME:0:8}…)가 있어요. 삭제할까요? [y/N] " A
  if [ "$A" = "y" ] || [ "$A" = "Y" ]; then
    vercel env rm "$NAME" --environment production --confirm-name "$NAME" >/dev/null 2>&1 \
      && echo "✓ 삭제함" || echo "✗ 삭제 실패 — Vercel 대시보드에서 지워 주세요"
  fi
done

echo "→ 운영 사이트 재배포 중 (1~2분)…"
vercel redeploy "$PROD_URL" --environment production >/dev/null 2>&1 \
  || { echo "✗ 재배포 실패 — Vercel 대시보드 → Deployments → Redeploy 로 해 주세요"; exit 1; }
echo "✓ 재배포 완료"

echo "→ 운영 사이트 음성 확인 중…"
P="$(curl -s -o /dev/null -D - -X POST "$PROD_URL/api/tts" -H 'Content-Type: application/json' \
  -d '{"text":"안녕하세요, 정오의 희망곡입니다."}' | tr -d '\r' | awk -F': ' 'tolower($1)=="x-tts-provider"{print $2}')"
if [ "$P" = "elevenlabs" ]; then
  echo "✓ 완료! 이제 🔊 버튼이 ElevenLabs 목소리로 읽어요."
else
  echo "! 운영 사이트가 아직 '${P:-응답 없음}' 목소리로 읽고 있어요. 1~2분 뒤 다시 확인해 보세요."
fi
