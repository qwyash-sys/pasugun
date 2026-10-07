import { useCallback, useEffect, useMemo, useState } from "react";
import { getAdminApi } from "../api";
import type { CaseDoc, CaseItem } from "../api/types";
import { applyAction, availableActions, CHOICE_LABEL, needsHq, OUTCOME_LABEL, POSTCHECK_STATUSES, urgency, type ActionPayload, type CaseAction } from "../engine/cases";
import { fmtShort, kstIso, wonShort } from "../format";
import { Badge, Card, Empty, ErrorBox, Kpi, Loading, PageHeader, Segmented, useLoad, useToast } from "../components/ui";
import CaseDrawer from "./monitoring/CaseDrawer";
import { CHOICE_TONE, statusTone } from "./monitoring/labels";

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
  const [selected, setSelected] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(() => new Date());
  const [fresh, setFresh] = useState<string | null>(null);
  const { show, node } = useToast();
  const { reload } = list;

  // 서버 모드는 고객 화면에서 들어오는 새 건을 위해 주기적으로 새로 읽는다.
  useEffect(() => {
    if (api.mode !== "local") return;
    const id = window.setInterval(() => {
      void reload(true).then(() => setUpdatedAt(new Date()));
    }, 15000);
    return () => window.clearInterval(id);
  }, [api.mode, reload]);

  const items = useMemo(() => list.data ?? [], [list.data]);
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
      .filter((i) => !kw || [i.case.case_id, i.report.customer_name, i.report.payee_name].some((s) => s.includes(kw)))
      .sort((a, b) => urgency(b.case) - urgency(a.case) || b.case.created_at.localeCompare(a.case.created_at));
  }, [items, queue, severity, query]);

  const stats = useMemo(() => {
    const open = items.filter((i) => isOpenCase(i.case));
    return {
      urgent: open.filter((i) => i.case.severity === "초고위험").length,
      fraud: items.filter((i) => i.case.outcome === "fraud_confirmed").length,
      fraudAmount: items.filter((i) => i.case.outcome === "fraud_confirmed").reduce((s, i) => s + i.report.amount, 0),
    };
  }, [items]);

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
        show(next.status === "종결" ? `${label} — 사례를 종결했어요.` : `${label} 완료 → ${next.status}`);
      } catch (e) {
        show(e instanceof Error ? e.message : "처리하지 못했어요.", "danger");
        throw e;
      }
    },
    [api, list, show],
  );

  const simulate = async () => {
    if (!api.simulateIncoming) return;
    const doc = await api.simulateIncoming();
    await list.reload(true);
    setQueue("hq");
    setFresh(doc.case_id);
    show(`신규 위험 거래가 들어왔어요 — ${doc.case_id}`);
    window.setTimeout(() => setFresh(null), 4000);
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

      <div className="c-kpis">
        <Kpi label="본부 조치 필요" value={counts.hq} sub="지금 처리할 사례" tone="danger" onClick={() => setQueue("hq")} active={queue === "hq"} />
        <Kpi label="초고위험 진행 중" value={stats.urgent} sub="최우선 확인" tone="warn" onClick={() => { setQueue("all"); setSeverity("초고위험"); }} active={severity === "초고위험"} />
        <Kpi label="영업점 면담 진행" value={counts.visit} sub="내방 예약 건" tone="blue" onClick={() => setQueue("visit")} active={queue === "visit"} />
        <Kpi label="지연송금 검토 진행" value={counts.delayed} sub="송금 강행 건" tone="warn" onClick={() => setQueue("delayed")} active={queue === "delayed"} />
        <Kpi label="사후 확인 필요" value={counts.post} sub="실행된 송금 재분석" tone="purple" onClick={() => setQueue("post")} active={queue === "post"} />
        <Kpi label="보이스피싱 확정" value={stats.fraud} sub={`피해 시도액 ${wonShort(stats.fraudAmount)}`} tone="default" onClick={() => setQueue("done")} active={false} />
      </div>

      <Card
        title="위험 리포트 목록"
        sub="최종 판정이 ‘위험’으로 저장된 모든 리포트예요. 행을 누르면 근거·조치·이력을 볼 수 있어요."
        actions={
          <div className="c-filters">
            <select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)} aria-label="위험 등급">
              <option value="">전체 등급</option>
              <option value="초고위험">초고위험</option>
              <option value="고위험">고위험</option>
            </select>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="고객명·수취인·리포트번호" aria-label="검색" />
          </div>
        }
      >
        <div className="c-queue">
          <Segmented
            label="처리 단계"
            value={queue}
            onChange={(v) => {
              setQueue(v);
              if (v !== "all") setSeverity("");
            }}
            options={[
              { id: "hq", label: "본부 조치 필요", count: counts.hq },
              { id: "visit", label: "영업점 내방", count: counts.visit },
              { id: "delayed", label: "지연송금", count: counts.delayed },
              { id: "post", label: "사후 확인", count: counts.post },
              { id: "pending", label: "고객 선택 대기", count: counts.pending },
              { id: "done", label: "종결", count: counts.done },
              { id: "all", label: "전체", count: counts.all },
            ]}
          />
        </div>

        {rows.length === 0 ? (
          <Empty>{queue === "hq" && !query && !severity ? "지금 조치가 필요한 사례가 없어요. 👍" : "조건에 맞는 사례가 없어요."}</Empty>
        ) : (
          <div className="c-table-wrap">
            <table className="c-table">
              <thead>
                <tr>
                  <th>등급</th>
                  <th>리포트</th>
                  <th>시도 일시</th>
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
                        <Badge tone={c.severity === "초고위험" ? "danger" : "warn"}>{c.severity}</Badge>
                      </td>
                      <td className="nowrap">
                        <b>{c.case_id}</b>
                        {r.rag_type && <div className="c-muted c-small">{r.rag_type}</div>}
                      </td>
                      <td className="nowrap">{fmtShort(r.attempted_at)}</td>
                      <td className="nowrap">
                        {r.customer_name} → {r.payee_name}
                        <div className="c-muted c-small">{r.payee_bank}</div>
                      </td>
                      <td className="num">{wonShort(r.amount)}</td>
                      <td>
                        <Badge tone={CHOICE_TONE[c.choice]}>{CHOICE_LABEL[c.choice]}</Badge>
                      </td>
                      <td>
                        <Badge tone={statusTone(c)}>{c.status}</Badge>
                        {c.outcome && <div className="c-muted c-small">{OUTCOME_LABEL[c.outcome]}</div>}
                      </td>
                      <td className="c-small">{needsHq(c) && next ? <b>{next.label}</b> : isOpenCase(c) ? <span className="c-muted">상대 응답 대기</span> : <span className="c-muted">-</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && <CaseDrawer key={selected} caseId={selected} rev={rev} onClose={() => setSelected(null)} onAct={onAct} />}
      {node}
    </div>
  );
}
