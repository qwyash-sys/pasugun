// 관리자 리포트 목록/상세. 실제 모드는 백엔드 /api/reports, 데모 모드(Vercel엔 백엔드가 없다)는
// 데모 케이스 리포트 3건 + 과거 리포트 목업(reportHistory.json — 백엔드와 같은 생성기 산출물)을
// 브라우저에서 같은 규칙으로 걸러 보여준다.
import { API_BASE_URL, RESPONSE_SOURCE } from "../config";
import { DEMO_CASES } from "../demoData/cases";
import history from "../demoData/reportHistory.json";
import type { ReportListResponse, ReportPayload, ReportQuery, ReportSummary } from "../types";
import { captureDataUrl } from "../utils/capturePreview";

interface HistoryEntry {
  report: Omit<ReportPayload, "attachments">;
  attachments: { name: string; lines: string[] }[];
}

/** 백엔드가 준 상대경로(/api/...)는 API 서버 주소를 붙여야 <img>로 열린다. data: URL은 그대로. */
export function resolveAssetUrl(url: string): string {
  return url.startsWith("/") ? `${API_BASE_URL}${url}` : url;
}

export const REPORT_PAGE_SIZE = 8;
export const EMPTY_REPORT_QUERY: ReportQuery = {
  q: "",
  account_level: "",
  context_level: "",
  rag_type: "",
  date_from: "",
  date_to: "",
  page: 1,
  page_size: REPORT_PAGE_SIZE,
};

let demoReports: ReportPayload[] | null = null;

function allDemoReports(): ReportPayload[] {
  if (!demoReports) {
    const fromCases = DEMO_CASES.flatMap((c) => (c.report ? [c.report] : []));
    const fromHistory = (history as unknown as HistoryEntry[]).map((h) => ({
      ...h.report,
      attachments: h.attachments.map((a) => ({ name: a.name, url: captureDataUrl(a.lines) })),
    }));
    demoReports = [...fromCases, ...fromHistory];
  }
  return demoReports;
}

function toSummary(r: ReportPayload): ReportSummary {
  const ragHit = !!(r.rag && r.rag.hit);
  return {
    report_id: r.report_id,
    generated_at: r.generated_at,
    attempted_at: r.attempted_at,
    customer_name: r.customer_name,
    payee_bank: r.payee_bank,
    payee_name: r.payee_name,
    amount: r.amount,
    account_score: r.account.total_score,
    account_level: r.final.account_level,
    context_score: r.context ? r.context.total_score : null,
    context_level: r.final.context_level,
    hard_override: r.final.hard_override,
    rag_type: ragHit ? r.rag!.matched_type : null,
    rag_similarity: ragHit ? r.rag!.similarity : null,
    attachment_count: r.attachments.length,
  };
}

// backend/app/report_store.py ReportStore.search와 같은 규칙(정렬도 같은 생성 시각 기준).
function matches(r: ReportPayload, q: ReportQuery): boolean {
  if (q.account_level && r.final.account_level !== q.account_level) return false;
  if (q.context_level && r.final.context_level !== q.context_level) return false;
  if (q.rag_type) {
    const matched = r.rag && r.rag.hit ? r.rag.matched_type : null;
    if (q.rag_type === "none" ? matched !== null : matched !== q.rag_type) return false;
  }
  const day = r.attempted_at.slice(0, 10);
  if (q.date_from && day < q.date_from) return false;
  if (q.date_to && day > q.date_to) return false;
  const keyword = q.q.trim();
  if (keyword && ![r.report_id, r.customer_name, r.payee_name, r.payee_account].some((s) => s.includes(keyword)))
    return false;
  return true;
}

export async function listReports(q: ReportQuery): Promise<ReportListResponse> {
  if (RESPONSE_SOURCE === "demo") {
    const found = allDemoReports()
      .filter((r) => matches(r, q))
      .sort((a, b) => Date.parse(b.generated_at) - Date.parse(a.generated_at));
    const start = (q.page - 1) * q.page_size;
    return {
      items: found.slice(start, start + q.page_size).map(toSummary),
      total: found.length,
      page: q.page,
      page_size: q.page_size,
    };
  }

  const params = new URLSearchParams({ page: String(q.page), page_size: String(q.page_size) });
  for (const key of ["q", "account_level", "context_level", "rag_type", "date_from", "date_to"] as const) {
    if (q[key]) params.set(key, q[key]);
  }
  const res = await fetch(`${API_BASE_URL}/api/reports?${params}`);
  if (!res.ok) throw new Error(`리포트 목록 조회 실패: ${res.status}`);
  return res.json();
}

export async function getReport(reportId: string): Promise<ReportPayload> {
  if (RESPONSE_SOURCE === "demo") {
    const found = allDemoReports().find((r) => r.report_id === reportId);
    if (!found) throw new Error("리포트를 찾을 수 없어요");
    return found;
  }
  const res = await fetch(`${API_BASE_URL}/api/reports/${encodeURIComponent(reportId)}`);
  if (!res.ok) throw new Error(`리포트 조회 실패: ${res.status}`);
  return res.json();
}
