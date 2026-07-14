// ── 로컬 개발 서버 (Vercel 로그인 없이 로컬 테스트용) ─────────────────
//   node dev-server.js  →  http://localhost:3000
//   - index.html 정적 제공
//   - /api/tags, /api/select 를 Vercel 핸들러와 동일하게 실행 (res.status/json 셰임 제공)
//   - .env.local 에서 키 로드
//   ※ 이 파일은 로컬 편의용이며 Vercel 배포에는 사용되지 않습니다.
const http = require("http");
const fs = require("fs");
const path = require("path");

// .env.local 로드
try {
  const env = fs.readFileSync(path.join(__dirname, ".env.local"), "utf8");
  env.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith("#")) process.env[m[1]] = m[2];
  });
  console.log("[dev] .env.local 로드됨");
} catch (_) {
  console.warn("[dev] .env.local 없음 — 키 미설정 시 프록시가 500을 반환합니다");
}

const tagsHandler = require("./api/tags.js");
const selectHandler = require("./api/select.js");
const chartHandler = require("./api/chart.js");
const poolHandler = require("./api/pool.js");

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

// Vercel 스타일 res 헬퍼(shim)
function decorate(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(obj));
  };
  return res;
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];

  if (url.startsWith("/api/")) {
    decorate(res);
    req.body = await readBody(req);
    try {
      if (url === "/api/chart") return await chartHandler(req, res);
      if (url === "/api/pool") return await poolHandler(req, res);
      if (url === "/api/tags") return await tagsHandler(req, res);
      if (url === "/api/select") return await selectHandler(req, res);
      return res.status(404).json({ error: "not found" });
    } catch (e) {
      return res.status(500).json({ error: String(e.message || e) });
    }
  }

  // 정적: index.html
  const file = url === "/" ? "index.html" : url.slice(1);
  const full = path.join(__dirname, file);
  if (full.startsWith(__dirname) && fs.existsSync(full) && fs.statSync(full).isFile()) {
    const ext = path.extname(full).toLowerCase();
    const type = ext === ".html" ? "text/html; charset=utf-8"
      : ext === ".js" ? "text/javascript" : "text/plain; charset=utf-8";
    res.setHeader("Content-Type", type);
    return res.end(fs.readFileSync(full));
  }
  res.statusCode = 404;
  res.end("Not found");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[dev] http://localhost:${PORT} 에서 실행 중`));
