// 데모 모드(서버 없음)에서 이번 시연 중에 새로 만들어진 리포트를 이 브라우저에 보관한다.
// 실제 모드는 서버가 리포트 번호·생성 시각을 매기고 목록·모니터링이 같은 번호를 보므로,
// 데모도 결과 화면에 들어오는 순간 '지금' 기준의 새 번호를 붙이고 같은 번호를 끝까지 쓴다.
import type { ReportPayload } from "../types";

const KEY = "pasugun.demo.reports.v2";
const ALL_KEYS = ["reports", "cases", "logs", "rules"].map((k) => `pasugun.demo.${k}.v2`);

// 시드 데이터가 바뀐 이전 버전(v1)의 시연 기록은 새 데이터와 섞이면 안 되므로 지운다.
try {
  for (const k of ["reports", "cases", "logs", "rules"]) localStorage.removeItem(`pasugun.demo.${k}.v1`);
} catch {
  /* 저장소 접근 불가 */
}

/** 시연 중에 쌓인 데모 기록(새 리포트·사례 처리·거래 로그·룰 변경)을 모두 지우고 처음 상태로. */
export function resetDemoData(): void {
  try {
    for (const k of ALL_KEYS) localStorage.removeItem(k);
  } catch {
    /* 저장소 접근 불가 */
  }
}
const MAX_KEEP = 30; // 첨부 미리보기가 data URL이라 너무 많이 쌓이지 않게 한다

const KST_OFFSET_MS = 9 * 3600_000;
const kstIso = (d: Date): string => new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 19) + "+09:00";

export function loadDemoReports(): ReportPayload[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ReportPayload[]) : [];
  } catch {
    return [];
  }
}

export function saveDemoReport(report: ReportPayload): void {
  const list = loadDemoReports().filter((r) => r.report_id !== report.report_id);
  list.push(report);
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_KEEP)));
  } catch {
    /* 저장소가 막혀 있으면 이번 화면에서만 보인다 */
  }
}

/** 오늘(KST) 날짜의 다음 데모 리포트 번호: RPT-YYYYMMDD-9NN (9로 시작해 시드 데이터와 겹치지 않는다). */
export function nextDemoReportId(now: Date = new Date()): string {
  const day = kstIso(now).slice(0, 10).replaceAll("-", "");
  const prefix = `RPT-${day}-9`;
  const used = loadDemoReports()
    .map((r) => r.report_id)
    .filter((id) => id.startsWith(prefix))
    .map((id) => Number(id.slice(prefix.length)) || 0);
  return `${prefix}${String(Math.max(0, ...used) + 1).padStart(2, "0")}`;
}

/** 시연 케이스의 고정 리포트에 새 번호와 지금 시각을 붙인 사본. */
export function freshDemoReport(source: ReportPayload, now: Date = new Date()): ReportPayload {
  const at = kstIso(now);
  return { ...structuredClone(source), report_id: nextDemoReportId(now), generated_at: at, attempted_at: at };
}
