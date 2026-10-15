// AI파수꾼 시연 영상 자동 녹화 (약 2분, 1920×1080).
//
// 준비: 데모 모드(기본 http://localhost:5174)와 로컬 모드(기본 http://localhost:5173) 프론트, 백엔드(8000)가 떠 있어야 한다.
// 사례집 장면이 사례를 실제로 등록하므로, 녹화 후 백엔드를 다시 켜면 기본 사례 12건으로 돌아간다.
//
//   cd tools/video && npm install && npx playwright install chromium && npm run record
//   → out/pasugun-demo.mp4
import { chromium } from "playwright";
import ffmpeg from "ffmpeg-static";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, "out");
const RAW = path.join(OUT, "raw");
const DEMO = process.env.DEMO_URL ?? "http://localhost:5174";
const LOCAL = process.env.LOCAL_URL ?? "http://localhost:5173";
const TITLES = pathToFileURL(path.join(DIR, "titles.html")).href;
const W = 1920, H = 1080;
const STEPS = ["① 송금위험도", "② AI 분석", "③ 최종 판정"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

rmSync(RAW, { recursive: true, force: true });
mkdirSync(RAW, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: RAW, size: { width: W, height: H } },
  locale: "ko-KR",
  timezoneId: "Asia/Seoul",
});
await ctx.addInitScript({ content: readFileSync(path.join(DIR, "overlay.js"), "utf8") });
const page = await ctx.newPage();
const t0 = Date.now();
const mark = (name) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${name}`);

const ov = (fn, ...args) => page.evaluate(([f, a]) => window.__ov[f](...a), [fn, args]);

/** 어두운 커튼으로 덮고 이동한 뒤, 무대를 바꾸고 커튼을 걷는다. */
async function go(url, stage = "", settle = 900) {
  await ov("close").catch(() => {});
  await sleep(500);
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(settle);
  await ov("stage", stage);
  await sleep(150);
  await ov("open");
  await sleep(500);
}

async function tap(loc, pause = 450) {
  try {
    await tapInner(loc, pause);
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, "fail.png") });
    throw e;
  }
}

async function tapInner(loc, pause) {
  await loc.scrollIntoViewIfNeeded({ timeout: 8000 });
  await sleep(150);
  const b = await loc.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await ov("cursor", x, y);
  await sleep(620);
  await ov("ripple", x, y);
  await loc.click();
  await sleep(pause);
}

async function spot(loc, label) {
  const b = await loc.boundingBox();
  await ov("spot", b.x, b.y, b.width, b.height, label ?? "");
}

const phone = (sel) => page.locator(".phone").locator(sel);

/** 기다리다 실패하면 그 순간 화면을 out/fail.png로 남긴다. */
async function waitFor(sel, timeout = 20000) {
  try {
    await page.waitForSelector(sel, { timeout });
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, "fail.png") });
    console.log("FAIL TEXT:", (await page.locator("body").innerText()).slice(0, 600));
    throw e;
  }
}

// ------------------------------------------------------------------ 0. 오프닝
mark("intro");
await go(`${TITLES}?s=intro`, "", 300);
await sleep(3300);
mark("stats");
await go(`${TITLES}?s=stat1`, "", 300);
await sleep(4300);
await go(`${TITLES}?s=stat2`, "", 300);
await sleep(4800);
mark("problem");
await go(`${TITLES}?s=problem`, "", 300);
await sleep(3900);

// ------------------------------------------------------------------ 1. 고객 화면(관리자 뷰로 한 번에)
mark("customer");
await go(`${DEMO}/`, "phone", 1200);
await ov("panel", "시연 시나리오", "검찰 사칭 · 2,000만원", "“검찰 수사관”이 계좌가 범죄에 연루됐다며<br>적금을 깨서 <b>안전계좌</b>로 옮기라고 한 상황이에요");
await sleep(1300);
await tap(page.locator("button", { hasText: "관리자 뷰" }).first());
await tap(phone("text=검찰사칭").first(), 700);

await ov("steps", STEPS, 0);
await ov("panel", "STEP 1 · 송금위험도", "보내기 전에<br>계좌부터 채점해요", "룰 11개 — 사기신고 이력, 금액 이상치, 신규 수취인,<br>잔액 소진, 수취계좌 입금 집중 …");
await sleep(1000);
await tap(phone("button.btn-primary"), 600);
await sleep(700);
await tap(phone("button.btn-primary"), 600);

await page.waitForSelector(".phone button.choice-btn", { timeout: 20000 });
await ov("steps", STEPS, 1);
await ov("panel", "STEP 2 · 상황 확인", "점수가 높으면<br>짧게 물어봐요", "고른 답에 따라 <b>AI 대화의 첫 질문</b>이 달라져요");
await sleep(1500);
for (let i = 0; i < 3; i++) {
  const s = phone("button.scripted:not(.chat-suggestion-btn)");
  if (!(await s.count())) break;
  await tap(s.first(), 1300);
}

await waitFor(".phone textarea");
await ov("panel", "STEP 2 · AI 대화", "속은 정황을<br>대화로 확인해요", "AI 에이전트가 묻고, 캡처는 <b>OCR</b>로 읽어<br>사기 사례 12종과 <b>의미 유사도(RAG)</b>로 비교해요");
const sendBtn = ".phone button.chat-send-btn:not(.chat-attach-btn)";
const resultReady = ".phone button.btn-primary:has-text('결과 확인하기')";
for (let turn = 0; turn < 3; turn++) {
  // 추천 문장(시연 대본)을 눌러 입력창을 채우고 보낸다. AI 답이 끝나면 다음 추천 문장이나 '결과 확인하기'가 켜진다.
  await waitFor(`.phone button.chat-suggestion-btn, ${resultReady}`, 30000);
  if (await page.locator(resultReady).count()) break;
  await sleep(900);
  await tap(phone("button.chat-suggestion-btn").first(), 800);
  await waitFor(`${sendBtn}:not([disabled])`);
  await tap(phone("button.chat-send-btn:not(.chat-attach-btn)"), 600);
  await page.waitForFunction(() => !document.querySelector(".phone button.chat-suggestion-btn"), null, { timeout: 10000 }).catch(() => {});
}
await waitFor(resultReady, 30000);
await sleep(600);
// 첨부한 캡처를 하나씩 크게 열어 보여준다
const thumbs = phone("button.chat-thumb-open");
const nThumbs = await thumbs.count();
if (nThumbs) await ov("panel", "STEP 2 · 캡처 분석", "첨부한 캡처도<br>함께 읽어요", "문자·메신저 캡처는 <b>OCR</b>로 글자를 읽어<br>대화와 함께 분석에 반영해요");
for (let i = 0; i < nThumbs; i++) {
  await tap(thumbs.nth(i), 500);
  const img = page.locator(".lightbox-body img").first();
  if (await img.count()) await spot(img, `첨부 캡처 ${i + 1}/${nThumbs}`);
  await sleep(1700);
  await ov("spotHide");
  const close = page.locator(".lightbox-head button").first();
  if (await close.count()) await tap(close, 500);
}
await sleep(400);
await tap(phone("button.btn-primary:has-text('결과 확인하기')"), 600);

await page.waitForSelector(".phone .verdict-final", { timeout: 30000 });
await sleep(900);
await ov("steps", STEPS, 2);
const grade = (await phone(".verdict-grade").textContent().catch(() => "")).replace("모니터링", "").trim();
const finalText = (await phone(".verdict-final-head strong").textContent()).trim();
void grade;
await ov("panel", "STEP 3 · 최종 판정", finalText, "송금은 막지 않아요.");
await phone(".customer-guide").scrollIntoViewIfNeeded();
await sleep(500);
await spot(phone(".verdict-final"), "최종 판정 · 본부 모니터링 등급");
await sleep(2200);
await ov("spotHide");

const toggle = phone(".admin-basis-toggle");
await ov("panel", "관리자 뷰", "상세한 판정근거는<br>다음과 같아요", "<b>1·2·3단계</b> 순으로 최종 위험지표 판정 확인");
await tap(toggle, 900);
const gauges = await phone(".level-gauge-head strong").allTextContents();
const fmtGauge = (t = "") => t.replace(/\s+/g, " ").replace(/\s*→\s*/, " → ").trim();
const hardNote = await phone(".verdict-basis-note.danger").count();
await phone(".verdict-matrix").evaluate((e) => e.scrollIntoView({ behavior: "smooth", block: "center" }));
await sleep(900);
await ov(
  "panel",
  "관리자 뷰 · 판정근거",
  `<span style="display:inline-flex;flex-direction:column;align-items:center;gap:4px"><span>송금위험 ${fmtGauge(gauges[0])}</span><span style="color:#5FD08F">×</span><span>AI분석 ${fmtGauge(gauges[1])}</span></span>`,
  hardNote ? "RAG상 결정적 피싱 징후 포착 시 <b>“위험”</b> 판정" : "매트릭스로 최종 판정",
);
await spot(phone(".verdict-matrix"), "3단계 · 판정 매트릭스");
await sleep(2200);
if (hardNote) {
  await phone(".verdict-basis-note.danger").evaluate((e) => e.scrollIntoView({ behavior: "smooth", block: "center" }));
  await sleep(800);
  await spot(phone(".verdict-basis-note.danger"), "결정적 피싱 징후");
  await sleep(1900);
}
await ov("spotHide");

await ov("panel", "고객 선택", "가까운 영업점<br>상담을 예약해요", "예약하면 <b>영업점 책임자</b>와 <b>본부</b>에 바로 전달돼요");
await tap(phone("button.btn-primary:has-text('영업점 상담 예약')"), 900);
await tap(phone("button.btn-primary"), 800);
await tap(phone("button.btn-primary:has-text('확인')"), 1400);

// ------------------------------------------------------------------ 2. 본부 · 영업점
mark("hq");
await go(`${TITLES}?s=bumper&n=02&t=${encodeURIComponent("본부 · 영업점")}&d=${encodeURIComponent("위험 거래를 고객 선택에 따라 끝까지 처리합니다")}`, "", 300);
await sleep(2200);
await go(`${DEMO}/#/admin/monitoring`, "admin", 1800);
// 방금 고객 흐름에서 예약한 2,000만원 건(목록 정렬 순서와 무관하게 찾는다)
const visitCard = page.locator("button, [role=button], .c-kpi", { hasText: "영업점 면담 진행" }).first();
await ov("cap", "본부 모니터링", "위험 거래를 <b>처리 단계별</b>로 나눠 관리해요");
await sleep(1200);
await tap(visitCard, 900);
const firstRow = page.locator(".c-table tbody tr", { hasText: "2,000만" }).first();
await firstRow.waitFor({ timeout: 15000 });
await ov("cap", "본부 모니터링", "방금 예약한 고객 건이 <b>영업점 면담</b> 단계로 들어왔어요");
const rowGrade = (await firstRow.locator("td").first().textContent())?.trim() ?? "";
await spot(firstRow, `방금 들어온 건 · ${rowGrade}`);
await sleep(2500);
await ov("spotHide");
await tap(firstRow, 1200);
await ov("cap", "사례 상세", "판정 리포트 · 처리 기한 · <b>지금 할 조치</b>를 한 화면에");
await sleep(2400);
const toBranch = page.locator("a.c-link", { hasText: "책임자 화면 열기" }).first();
if (await toBranch.count()) {
  await spot(toBranch, "영업점 책임자에게 연결");
  await sleep(1400);
  await ov("spotHide");
  await tap(toBranch, 250);
} else {
  await page.keyboard.press("Escape");
  await page.evaluate(() => { location.hash = "#/admin/branch"; });
  await sleep(1600);
}
await ov("cap", "영업점 책임자", "면담 요청 메일을 확인하고 <b>면담 결과를 입력</b><br>→ 본부가 확인 후 종결");
await sleep(1600);
const resultBtn = page.locator("button.c-btn", { hasText: /^\s*면담 결과 입력\s*$/ }).first();
if (await resultBtn.count()) {
  await spot(resultBtn, "영업점 책임자 조치사항");
  await sleep(1800);
  await ov("spotHide");
  await tap(resultBtn, 1800);
  await page.keyboard.press("Escape");
}
await sleep(600);

// ------------------------------------------------------------------ 3. 사례집(RAG) 관리 — 로컬(개발) 모드, 실제 SBERT + FAISS
mark("library");
await go(`${TITLES}?s=bumper&n=03&t=${encodeURIComponent("사례집(RAG) 관리")}&d=${encodeURIComponent("새로운 보이스피싱 사례를 등록하면 즉시 적용, 탐지가 가능합니다")}`, "", 300);
await sleep(2200);
await go(`${LOCAL}/#/admin/library`, "admin", 2500);
await page.waitForSelector(".c-library tbody tr", { timeout: 30000 });
await ov("cap", "사례집 관리", "2단계 RAG에 쓰는 사기 사례 · 유형별 탐지 현황 · 검증 문장 점검");
await spot(page.locator(".c-kpis"), "");
await sleep(2100);
await ov("spotHide");
await tap(page.locator("button", { hasText: "유사도 시험" }).first(), 500);
const SENTENCE = "코인 리딩방에서 원금 보장해준다고 투자금을 이 계좌로 넣으래요";
const box = page.locator(".c-rag-form textarea");
await tap(box, 200);
await box.pressSequentially(SENTENCE, { delay: 35 });
await tap(page.locator(".c-rag-form button"), 300);
await page.waitForSelector(".c-sim-list li", { timeout: 30000 });
await sleep(800);
const before = (await page.locator(".c-sim-list li .c-sim-val").first().textContent()).trim();
await ov("cap", "유사도 시험", `신종 수법 문장 → 가장 비슷한 사례도 <b>${before}</b> · 매칭 기준 0.60 미달`);
await spot(page.locator(".c-sim-list li").first(), `${before} · 점수 없음`);
await sleep(2700);
await ov("spotHide");

await tap(page.locator("button", { hasText: "사례 등록" }).first(), 600);
await ov("cap", "신종 수법 등록", "투자 리딩방 시나리오를 사례집에 추가");
await page.getByPlaceholder("예: 기관사칭").pressSequentially("투자사기", { delay: 40 });
await page.getByPlaceholder("예: 검찰청 사칭").pressSequentially("가상자산 투자 리딩방", { delay: 30 });
await page.getByPlaceholder("누가 무엇을 명목으로 접근해 어디로 돈을 보내게 하는지").fill("코인 리딩방에서 고수익을 약속하며 지정 거래소 계좌로 투자금 입금을 유도");
await page.locator(".c-modal textarea").nth(1).fill("리딩방 VIP만 받는 코인 정보입니다\n원금 보장에 수익 300% 드립니다\n이 계좌로 투자금 넣으시면 바로 매수해드려요");
await sleep(900);
await tap(page.locator(".c-modal button.c-btn-primary"), 400);
await page.waitForFunction(() => document.querySelector(".c-sim-list li .c-sim-label b")?.textContent?.startsWith("S1") && !document.querySelector(".c-sim-list li .c-sim-label b")?.textContent?.startsWith("S10"), null, { timeout: 30000 }).catch(() => {});
await sleep(1200);
const after = (await page.locator(".c-sim-list li .c-sim-val").first().textContent()).trim();
await ov("cap", "등록 즉시 반영", `같은 문장이 <b>${after} 강한 매칭</b> → 상황 점수 +50점, 고객 판정에도 바로 적용`);
await spot(page.locator(".c-sim-list li").first(), `${before} → ${after}`);
await sleep(3300);
await ov("spotHide");
await ov("capHide");

// ------------------------------------------------------------------ 4. 엔딩
mark("outro");
await go(`${TITLES}?s=outro`, "", 300);
await sleep(5600);
await ov("close");
await sleep(900);
mark("end");

const video = page.video();
await ctx.close();
await browser.close();
const raw = await video.path();
const mp4 = path.join(OUT, "pasugun-demo.mp4");
execFileSync(ffmpeg, ["-y", "-i", raw, "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", mp4], { stdio: "inherit" });
console.log(`완료 → ${mp4}`);
