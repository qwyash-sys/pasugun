import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAdminApi } from "../api";
import type { CaseDoc, CaseItem } from "../api/types";
import { applyAction, availableActions, CHOICE_LABEL, dueInfo, HOTLINE_LABEL, needsHq, OUTCOME_LABEL, POSTCHECK_STATUSES, urgency, type ActionPayload, type CaseAction } from "../engine/cases";
import { fmtShort, kstIso, wonShort } from "../format";
import { Badge, Card, Empty, ErrorBox, Kpi, Loading, PageHeader, useLoad, useToast } from "../components/ui";
import PeriodFilter, { inPeriod, periodOf, periodText, type Period } from "../components/PeriodFilter";
import CaseDrawer from "./monitoring/CaseDrawer";
import { CHOICE_TONE, statusLabel, statusTone, WAITING_ON } from "./monitoring/labels";

type Queue = "all" | "hq" | "visit" | "delayed" | "post" | "pending" | "done";

const isOpenCase = (c: CaseDoc) => c.status !== "종결";
const inQueue: Record<Queue, (c: CaseDoc) => boolean> = {
  all: () => true,
  hq: needsHq,
  visit: (c) => c.choice === "visit" && isOpenCase(c),
  delayed: (c) => c.choice === "delayed" && isOpenCase(c) && !POSTCHECK_STATUSES.includes(c.status),
  post: (c) => POSTCHECK_STATUSES.includes(c.status),
  pending: (c) => c.status === "고객 선택 대기",
  done: (c) => !isOpenCase(c),
};

export default function MonitoringPage() {
  const api = getAdminApi();
  const list = useLoad<CaseItem[]>(() => api.listCases(), []);
  const [queue, setQueue] = useState<Queue>("hq");
  const [severity, setSeverity] = useState<"" | "초고위험" | "고위험">("");
  const [query, setQuery] = useState("");
  const [choice, setChoice] = useState<"" | CaseDoc["choice"]>("");
  const [period, setPeriod] = useState<Period>(() => periodOf("7"));
  const [selected, setSelected] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(() => new Date());
  const [fresh, setFresh] = useState<string | null>(null);
  const { show, node } = useToast();
  const { reload } = list;
  const now = updatedAt;
  const known = useRef<Set<string> | null>(null);

  // 새로 들어온 위험 거래를 알린다(첫 로딩은 제외). 실제 모드는 15초 주기 갱신, 데모는 다른 탭의 고객 화면에서 생긴 건.
  useEffect(() => {
    if (!list.data) return;
    const ids = new Set(list.data.map((i) => i.case.case_id));
    const prev = known.current;
    known.current = ids;
    if (!prev) return;
    const arrived = [...ids].filter((id) => !prev.has(id));
    if (!arrived.length) return;
    show(`신규 위험 거래 ${arrived.length}건이 들어왔어요 — ${arrived[0]}`);
    setFresh(arrived[0]);
    const t = window.setTimeout(() => setFresh(null), 4000);
    return () => window.clearTimeout(t);
  }, [list.data, show]);

  // 데모: 같은 브라우저의 다른 탭(고객 화면)에서 사례가 생기거나 바뀌면 바로 반영한다.
  useEffect(() => {
    if (api.mode !== "demo") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith("pasugun.demo.")) void reload(true).then(() => setUpdatedAt(new Date()));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [api.mode, reload]);

  // 서버 모드는 고객 화면에서 들어오는 새 건을 위해 주기적으로 새로 읽는다.
  useEffect(() => {
    if (api.mode !== "local") return;
    const id = window.setInterval(() => {
      void reload(true).then(() => setUpdatedAt(new Date()));
    }, 15000);
    return () => window.clearInterval(id);
  }, [api.mode, reload]);

  const all = useMemo(() => list.data ?? [], [list.data]);
  // 기간(시도 일시 기준)을 먼저 적용하고, 위쪽 단계 카드 숫자와 아래 목록이 같은 기간을 본다.
  const items = useMemo(() => all.filter((i) => inPeriod(i.report.attempted_at, period, now)), [all, period, now]);
  const openOutside = useMemo(() => all.filter((i) => isOpenCase(i.case) && !inPeriod(i.report.attempted_at, period, now)).length, [all, period, now]);
  const counts = useMemo(() => {
    const out = {} as Record<Queue, number>;
    (Object.keys(inQueue) as Queue[]).forEach((q) => (out[q] = items.filter((i) => inQueue[q](i.case)).length));
    return out;
  }, [items]);

  const rows = useMemo(() => {
    const kw = query.trim();
    return items
      .filter((i) => inQueue[queue](i.case))
      .filter((i) => !severity || i.case.severity === severity)
      .filter((i) => !choice || i.case.choice === choice)
      .filter((i) => !kw || [i.case.case_id, i.report.customer_name, i.report.payee_name].some((s) => s.includes(kw)))
      .sort((a, b) => urgency(b.case) - urgency(a.case) || b.case.created_at.localeCompare(a.case.created_at));
  }, [items, queue, severity, choice, query]);

  const refresh = async () => {
    await list.reload(true);
    setUpdatedAt(new Date());
  };

  const onAct = useCallback(
    async (doc: CaseDoc, action: CaseAction["id"], payload: ActionPayload) => {
      try {
        let p = payload;
        if (action === "run_postcheck") {
          const res = await api.reanalyze(doc.case_id);
          p = { ...payload, activity: res.activity, analysis: res.analysis };
          if (res.llm === "fallback") show("AI 연결이 불안정해서 규칙 기반 설명문으로 분석했어요.", "warn");
        }
        const next = applyAction(doc, action, p, kstIso(new Date()));
        await api.saveCase(next);
        setRev((r) => r + 1);
        await list.reload(true);
        setUpdatedAt(new Date());
        const label = availableActions(doc).find((a) => a.id === action)?.label ?? "조치";
        show(next.status === "종결" ? `${label} — 사례를 종결했어요.` : `${label} 완료 → ${statusLabel(next.status)}`);
      } catch (e) {
        show(e instanceof Error ? e.message : "처리하지 못했어요.", "danger");
        throw e;
      }
    },
    [api, list, show],
  );

  const simulate = async () => {
    if (!api.simulateIncoming) return;
    await api.simulateIncoming();
    setQueue("all");
    setPeriod(periodOf("today"));
    await list.reload(true); // 알림·강조는 위의 '신규 건 감지'가 처리한다
  };

  if (list.loading && !list.data) return <div className="console-content"><Loading /></div>;
  if (list.error && !list.data) return <div className="console-content"><ErrorBox message={list.error} onRetry={() => void list.reload()} /></div>;

  return (
    <div className="console-content">
      <PageHeader
        title="모니터링"
        sub="최종 위험도로 분류되어 저장된 리포트를 모아 보고, 고객이 고른 방법(영업점 내방·지연송금)에 따라 본부가 조치해요."
        actions={
          <>
            <span className="c-muted c-small">
              {api.mode === "local" ? "15초마다 자동 갱신 · " : ""}
              {updatedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Seoul" })} 기준
            </span>
            <button className="c-btn" onClick={() => void refresh()}>
              ↻ 새로고침
            </button>
            {api.simulateIncoming && (
              <button className="c-btn" onClick={() => void simulate()} title="데모에서는 고객 앱 없이도 새 위험 거래가 들어오는 상황을 볼 수 있어요">
                ＋ 신규 위험 거래 유입(시연)
              </button>
            )}
          </>
        }
      />

      {/* 처리 단계(카드를 누르면 아래 목록이 그 단계만 보여준다) — 색: 본부 조치(빨강)·영업점 면담(파랑)·지연송금(노랑)·송금 재분석(초록) */}
      <div className="c-queue-cards" aria-label="처리 단계">
        <Kpi label="본부 조치 필요" value={counts.hq} sub="지금 본부가 처리할 사례" tone="danger" onClick={() => setQueue("hq")} active={queue === "hq"} />
        <Kpi label="영업점 면담 진행" value={counts.visit} sub="내방 예약 · 면담 결과 확인" tone="blue" onClick={() => setQueue("visit")} active={queue === "visit"} />
        <Kpi label="지연송금 검토 진행" value={counts.delayed} sub="본부 승인 · 고객 재확인" tone="warn" onClick={() => setQueue("delayed")} active={queue === "delayed"} />
        <Kpi label="재분석 필요(송금)" value={counts.post} sub="실행된 송금의 수취계좌 재분석" tone="green" onClick={() => setQueue("post")} active={queue === "post"} />
        <div className="c-queue-more">
          {(
            [
              ["pending", "고객 선택 대기"],
              ["done", "종결"],
              ["all", "전체"],
            ] as [Queue, string][]
          ).map(([id, label]) => (
            <button key={id} className={queue === id ? "on" : ""} aria-pressed={queue === id} onClick={() => setQueue(id)}>
              <span>{label}</span>
              <b>{counts[id]}</b>
            </button>
          ))}
        </div>
      </div>

      <Card title="위험 리포트 목록" sub={`최종 판정이 ‘위험’으로 저장된 리포트예요 · ${periodText(period, now)} · 행을 누르면 근거·조치·이력을 볼 수 있어요.`}>
        <div className="c-filters c-filters-row">
          <PeriodFilter value={period} onChange={setPeriod} />
          <select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)} aria-label="위험 등급">
            <option value="">전체 등급</option>
            <option value="초고위험">초고위험</option>
            <option value="고위험">고위험</option>
          </select>
          <select value={choice} onChange={(e) => setChoice(e.target.value as typeof choice)} aria-label="고객 선택">
            <option value="">전체 고객 선택</option>
            <option value="visit">영업점 내방 예약</option>
            <option value="delayed">지연송금</option>
            <option value="abandoned">송금 중단</option>
            <option value="pending">선택 없음</option>
          </select>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="고객명·수취인·리포트번호" aria-label="검색" />
          {(severity || choice || query || period.preset !== "7") && (
            <button
              className="c-btn c-btn-sm c-btn-ghost"
              onClick={() => {
                setSeverity("");
                setChoice("");
                setQuery("");
                setPeriod(periodOf("7"));
              }}
            >
              조건 초기화
            </button>
          )}
        </div>
        {openOutside > 0 && (
          <div className="c-note tone-warn c-outside">
            선택한 기간 밖에 아직 처리 중인 사례가 {openOutside}건 있어요.{" "}
            <button className="c-link" onClick={() => setPeriod(periodOf("all"))}>
              전체 기간으로 보기
            </button>
          </div>
        )}

        {rows.length === 0 ? (
          <Empty>{queue === "hq" && !query && !severity && !choice ? `${periodText(period, now)} 기간에 본부가 조치할 사례가 없어요. 👍` : "조건에 맞는 사례가 없어요."}</Empty>
        ) : (
          <div className="c-table-wrap">
            <table className="c-table c-cases">
              <thead>
                <tr>
                  <th>등급</th>
                  <th>리포트 · 시도 일시</th>
                  <th>고객 → 수취인</th>
                  <th className="num">금액</th>
                  <th>고객 선택</th>
                  <th>진행 상태</th>
                  <th>다음 할 일</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ case: c, report: r }) => {
                  const next = availableActions(c)[0];
                  return (
                    <tr key={c.case_id} className={`clickable ${selected === c.case_id ? "selected" : ""} ${fresh === c.case_id ? "c-fresh" : ""}`} onClick={() => setSelected(c.case_id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSelected(c.case_id)}>
                      <td>
                        <Badge tone={c.severity === "초고위험" ? "danger" : "orange"}>{c.severity}</Badge>
                      </td>
                      <td className="nowrap">
                        <b>{c.case_id}</b>
                        <div className="c-muted c-small">
                          {fmtShort(r.attempted_at)}
                          {r.rag_type && ` · ${r.rag_type}`}
                        </div>
                      </td>
                      <td className="nowrap">
                        {r.customer_name} → {r.payee_name}
                        <div className="c-muted c-small">{r.payee_bank}</div>
                      </td>
                      <td className="num">{wonShort(r.amount)}</td>
                      <td>
                        <div className="c-badges">
                          <Badge tone={CHOICE_TONE[c.choice]}>{CHOICE_LABEL[c.choice]}</Badge>
                          {(c.hotlines ?? []).map((h) => (
                            <Badge key={h} tone="blue">
                              {HOTLINE_LABEL[h]}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td>
                        <Badge tone={statusTone(c)}>{statusLabel(c.status)}</Badge>
                        {c.outcome && <div className="c-muted c-small">{OUTCOME_LABEL[c.outcome]}</div>}
                      </td>
                      <td className="c-small">
                        {needsHq(c) && next ? <b className="c-next-step">{next.label} ›</b> : isOpenCase(c) ? <span className="c-muted">{WAITING_ON[c.status] ?? "상대 응답 대기"}</span> : <span className="c-muted">처리 완료</span>}
                        {(() => {
                          const due = dueInfo(c, now);
                          return due && <div className={`c-due tone-${due.tone}`}>{due.text}</div>;
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && (
        <CaseDrawer
          key={selected}
          caseId={selected}
          rev={rev}
          onClose={() => setSelected(null)}
          onAct={onAct}
          position={(() => {
            const index = rows.findIndex((r) => r.case.case_id === selected);
            return index >= 0 ? { index, total: rows.length } : undefined;
          })()}
          onMove={(d) => {
            const index = rows.findIndex((r) => r.case.case_id === selected);
            const next = rows[index + d];
            if (next) setSelected(next.case.case_id);
          }}
        />
      )}
      {node}
    </div>
  );
}
