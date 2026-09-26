import { useEffect, useState } from "react";
import AppBar from "../components/AppBar";
import { RAG_TYPES } from "../components/signalMeta";
import { EMPTY_REPORT_QUERY, REPORT_PAGE_SIZE as PAGE_SIZE, listReports } from "../api/reports";
import type { ReportListResponse, ReportQuery, RiskLevel } from "../types";

const LEVELS: RiskLevel[] = ["고", "중", "저"];

interface Props {
  // 필터·페이지는 App이 들고 있어서, 리포트를 열었다가 돌아와도 보던 목록이 유지된다.
  query: ReportQuery;
  onQueryChange: (update: (q: ReportQuery) => ReportQuery) => void;
  backLabel: string;
  onBack: () => void;
  onOpen: (reportId: string) => void;
  onHome: () => void;
}

/** 페이지 번호 버튼은 현재 페이지 주변 최대 5개만 보여준다. */
function pageWindow(page: number, totalPages: number): number[] {
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export default function ReportList({ query, onQueryChange: setQuery, backLabel, onBack, onOpen, onHome }: Props) {
  const [keyword, setKeyword] = useState(query.q);
  // 마지막으로 받은 응답이 어떤 query에 대한 것인지 같이 기억해서, 로딩 여부는 따로 상태를 두지 않고 계산한다.
  const [loaded, setLoaded] = useState<{ query: ReportQuery; data: ReportListResponse | null; error: boolean } | null>(
    null,
  );
  const data = loaded?.data ?? null;
  const loading = loaded?.query !== query;
  const error = !loading && loaded?.error ? "리포트 목록을 불러오지 못했어요. 백엔드가 켜져 있는지 확인해주세요." : null;

  useEffect(() => {
    let cancelled = false;
    listReports(query)
      .then((res) => !cancelled && setLoaded({ query, data: res, error: false }))
      .catch(() => !cancelled && setLoaded({ query, data: null, error: true }));
    return () => {
      cancelled = true;
    };
  }, [query]);

  // 필터를 바꾸면 항상 1페이지부터 다시 본다.
  function update(patch: Partial<ReportQuery>) {
    setQuery((q) => ({ ...q, ...patch, page: 1 }));
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const filtered =
    query.q || query.account_level || query.context_level || query.rag_type || query.date_from || query.date_to;

  return (
    <>
      <AppBar title="AI파수꾼 리포트 목록" onBack={onBack} onHome={onHome} />

      <form
        className="report-filters"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: keyword.trim() });
        }}
      >
        <div className="report-filter-search">
          <input
            type="text"
            placeholder="고객명 · 예금주 · 계좌번호 · 리포트번호"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            maxLength={100}
          />
          <button type="submit" className="btn btn-primary">
            검색
          </button>
        </div>

        <div className="report-filter-grid">
          <label>
            송금위험 등급
            <select value={query.account_level} onChange={(e) => update({ account_level: e.target.value as RiskLevel | "" })}>
              <option value="">전체</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            AI분석 등급
            <select value={query.context_level} onChange={(e) => update({ context_level: e.target.value as RiskLevel | "" })}>
              <option value="">전체</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            RAG 유형
            <select value={query.rag_type} onChange={(e) => update({ rag_type: e.target.value })}>
              <option value="">전체</option>
              <option value="none">매칭 없음</option>
              {RAG_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            거래일자 시작
            <input type="date" value={query.date_from} max={query.date_to || undefined} onChange={(e) => update({ date_from: e.target.value })} />
          </label>
          <label>
            거래일자 끝
            <input type="date" value={query.date_to} min={query.date_from || undefined} onChange={(e) => update({ date_to: e.target.value })} />
          </label>
          <button
            type="button"
            className="btn btn-secondary report-filter-reset"
            disabled={!filtered}
            onClick={() => {
              setKeyword("");
              setQuery(() => EMPTY_REPORT_QUERY);
            }}
          >
            필터 초기화
          </button>
        </div>
      </form>

      <p className="report-list-count">
        {loading ? "불러오는 중…" : data ? `총 ${data.total.toLocaleString()}건 · 최신 리포트순 · ${query.page}/${totalPages} 페이지` : ""}
      </p>
      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

      <div className="report-list">
        {data?.items.map((r) => (
          <button key={r.report_id} className="report-item" onClick={() => onOpen(r.report_id)}>
            <div className="report-item-top">
              <span className="report-item-id">#{r.report_id}</span>
              <span className="report-item-date">거래 {r.attempted_at.slice(0, 16).replace("T", " ")}</span>
            </div>
            <div className="report-item-main">
              <strong>{r.customer_name}</strong> → {r.payee_name}({r.payee_bank}) · {r.amount.toLocaleString()}원
            </div>
            <div className="report-item-tags">
              <span className={`tag level-${r.account_level}`}>
                송금위험 {r.account_level} {r.account_score}
              </span>
              <span className={`tag level-${r.context_level}`}>
                AI분석 {r.context_level} {r.context_score ?? "-"}
              </span>
              {r.hard_override && <span className="tag tag-danger">결정적 징후</span>}
              <span className="tag">
                {r.rag_type ? `RAG ${r.rag_type} ${r.rag_similarity?.toFixed(2)}` : "RAG 매칭 없음"}
              </span>
              {r.attachment_count > 0 && <span className="tag">📷 {r.attachment_count}</span>}
            </div>
          </button>
        ))}
        {data && data.items.length === 0 && !loading && <p className="bar-row-empty">조건에 맞는 리포트가 없어요.</p>}
      </div>

      {data && data.total > PAGE_SIZE && (
        <div className="pagination">
          <button disabled={query.page === 1} onClick={() => setQuery((q) => ({ ...q, page: q.page - 1 }))} aria-label="이전 페이지">
            ‹
          </button>
          {pageWindow(query.page, totalPages).map((p) => (
            <button
              key={p}
              className={p === query.page ? "on" : ""}
              onClick={() => setQuery((q) => ({ ...q, page: p }))}
            >
              {p}
            </button>
          ))}
          <button
            disabled={query.page === totalPages}
            onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}
            aria-label="다음 페이지"
          >
            ›
          </button>
        </div>
      )}

      <div className="spacer" />
      <button className="btn btn-secondary" onClick={onBack}>
        {backLabel}
      </button>
    </>
  );
}
