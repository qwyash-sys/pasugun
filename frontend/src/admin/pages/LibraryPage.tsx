import { useMemo, useState } from "react";
import { getAdminApi, ConfigError } from "../api";
import type { RagCandidate, RagEvalCase, RulesState, Scenario, ScenarioHistoryEntry, ScenarioInput } from "../api/types";
import PeriodFilter, { inPeriod, periodOf, periodText, type Period, type PeriodPreset } from "../components/PeriodFilter";
import { Badge, BarRows, Card, Drawer, Empty, ErrorBox, Field, Kpi, Loading, Modal, PageHeader, Segmented, useLoad, useToast, type Tone } from "../components/ui";
import { loadAnalysisData, type AnalysisData } from "../data";
import { coverageByType, ragVerdict, scenarioErrors, strengthOf, usageByScenario, WEAK_COVERAGE, type RagStrength, type ScenarioUsage } from "../engine/rag";
import { HARD_OVERRIDE_SIGNALS } from "../engine/scoring";
import { fmtShort, pct } from "../format";
import ragDemo from "../../demoData/admin/ragDemo.json";

type Tab = "list" | "test" | "eval" | "history";
const PRESETS: PeriodPreset[] = ["7", "30", "90", "all", "custom"];

/** 유사도 시험 예시 문장: 검증 세트에서 유형별로 하나씩 + 정상 송금 둘. 데모·로컬 모드가 같은 문장을 쓴다. */
const SAMPLES: string[] = (() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of ragDemo.cases) {
    const key = c.expected ?? "정상";
    if (key === "정상" ? out.filter((t) => ragDemo.cases.find((x) => x.text === t)?.expected == null).length >= 2 : seen.has(key)) continue;
    seen.add(key);
    out.push(c.text);
  }
  return out;
})();

const STRENGTH: Record<RagStrength, { label: string; tone: Tone }> = {
  strong: { label: "강한 매칭", tone: "danger" },
  match: { label: "매칭", tone: "warn" },
  none: { label: "기준 미달", tone: "muted" },
};

const toInput = (s: Scenario): ScenarioInput => ({
  유형: s.유형, 중분류: s.중분류, 수법요약: s.수법요약, 범인멘트: s.범인멘트, 위험신호: s.위험신호, 위험도: s.위험도, 출처: s.출처, enabled: s.enabled !== false,
});

const EMPTY_INPUT: ScenarioInput = { 유형: "", 중분류: "", 수법요약: "", 범인멘트: [], 위험신호: [], 위험도: "고", 출처: "본부 등록", enabled: true };

function SignalChips({ signals }: { signals: string[] }) {
  return (
    <span className="c-chips">
      {signals.map((s) =>
        HARD_OVERRIDE_SIGNALS.has(s) ? (
          <span key={s} className="c-chip-hard" title="결정적 피싱 징후: 이 사례와 매칭되면 점수와 관계없이 바로 '위험' 판정이에요">
            {s}
          </span>
        ) : (
          <span key={s}>{s}</span>
        ),
      )}
    </span>
  );
}

/** 사례별 유사도 막대. 세로 눈금이 매칭(중)·강한 매칭(고) 기준값이다. */
function SimilarityList({ candidates, g, corpus }: { candidates: RagCandidate[]; g: Record<string, number>; corpus: Map<string, Scenario> }) {
  return (
    <ul className="c-sim-list">
      {candidates.map((c, i) => {
        const st = strengthOf(c.similarity, g);
        const sc = corpus.get(c.scenario_id);
        return (
          <li key={c.scenario_id} className={i === 0 ? "top" : ""}>
            <span className="c-sim-label">
              <b>{c.scenario_id}</b> {sc?.중분류 ?? c.matched_type}
              <small>{c.matched_type}</small>
            </span>
            <span className="c-sim-track" role="img" aria-label={`${c.scenario_id} 유사도 ${c.similarity.toFixed(2)}`}>
              <span className={`c-sim-fill sim-${st}`} style={{ width: `${Math.max(0, Math.min(1, c.similarity)) * 100}%` }} />
              <i className="c-sim-tick" style={{ left: `${g.rag_mid_sim * 100}%` }} title={`매칭 기준 ${g.rag_mid_sim}`} />
              <i className="c-sim-tick high" style={{ left: `${g.rag_high_sim * 100}%` }} title={`강한 매칭 기준 ${g.rag_high_sim}`} />
            </span>
            <span className="c-sim-val">{c.similarity.toFixed(2)}</span>
            <span className="c-sim-badge">{st !== "none" && <Badge tone={STRENGTH[st].tone}>{STRENGTH[st].label}</Badge>}</span>
          </li>
        );
      })}
    </ul>
  );
}

function VerdictNote({ candidates, g, corpus }: { candidates: RagCandidate[]; g: Record<string, number>; corpus: Map<string, Scenario> }) {
  const v = ragVerdict(candidates, g, corpus);
  if (!v.top) return <div className="c-note">사용 중인 사례가 없어요.</div>;
  const name = `${v.top.scenario_id} ${corpus.get(v.top.scenario_id)?.중분류 ?? v.top.matched_type}`;
  if (v.strength === "none")
    return (
      <div className="c-note">
        가장 비슷한 사례 <b>{name}</b> · 유사도 {v.top.similarity.toFixed(2)} → 매칭 기준 {g.rag_mid_sim} 미만이라 <b>상황 점수에 더하지 않아요.</b>
      </div>
    );
  return (
    <div className={`c-note ${v.hardSignals.length ? "tone-danger" : "tone-warn"}`}>
      가장 비슷한 사례 <b>{name}</b> · 유사도 {v.top.similarity.toFixed(2)} · <b>{STRENGTH[v.strength].label}</b> → 2단계 상황 점수 <b>+{v.score}점</b>
      {v.hardSignals.length > 0 && (
        <>
          . 이 사례에는 결정적 피싱 징후({v.hardSignals.join(", ")})가 있어 <b>점수와 관계없이 '위험'</b>으로 판정돼요
        </>
      )}
      .
    </div>
  );
}

/** 위험 신호 고르기: 결정적 피싱 징후 3개는 체크박스로 따로, 나머지는 기존 태그에서 고르거나 새로 추가한다.
 * 자유 입력이면 '안전 계좌' 같은 오타로 위험 강제 판정이 조용히 빠질 수 있어서다. 새 태그는 공백을 지워 맞춘다. */
const normalizeTag = (t: string): string => t.replace(/\s+/g, "");

function SignalPicker({ value, onChange, known }: { value: string[]; onChange: (v: string[]) => void; known: string[] }) {
  const [draft, setDraft] = useState("");
  const has = (t: string) => value.includes(t);
  const toggle = (t: string) => onChange(has(t) ? value.filter((x) => x !== t) : [...value, t]);
  const hard = [...HARD_OVERRIDE_SIGNALS];
  const others = [...new Set([...known, ...value])].filter((t) => !HARD_OVERRIDE_SIGNALS.has(t)).sort((a, b) => a.localeCompare(b, "ko"));
  const add = () => {
    const t = normalizeTag(draft);
    if (!t) return;
    if (!has(t)) onChange([...value, t]);
    setDraft("");
  };
  return (
    <div className="c-field">
      <span className="c-field-label">위험 신호</span>
      <div className="c-signal-hard">
        <strong>결정적 피싱 징후</strong>
        <small>체크하면 이 사례와 매칭되는 순간 점수와 관계없이 '위험' 판정이에요.</small>
        <div className="c-signal-hard-row">
          {hard.map((t) => (
            <label key={t} className={has(t) ? "on" : ""}>
              <input type="checkbox" checked={has(t)} onChange={() => toggle(t)} />
              {t}
            </label>
          ))}
        </div>
      </div>
      <div className="c-signal-tags" role="group" aria-label="일반 위험 신호">
        {others.map((t) => (
          <button key={t} type="button" className={`c-chip-btn ${has(t) ? "on" : ""}`} aria-pressed={has(t)} onClick={() => toggle(t)}>
            {has(t) ? "✓ " : ""}
            {t}
          </button>
        ))}
      </div>
      <div className="c-signal-add">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              add();
            }
          }}
          placeholder="목록에 없는 신호 추가 (예: 고수익보장)"
          maxLength={40}
        />
        <button type="button" className="c-btn c-btn-sm" onClick={add} disabled={!normalizeTag(draft)}>
          추가
        </button>
      </div>
      <span className="c-field-hint">일반 신호는 판정 근거 표시와 AI 룰 분석에 쓰여요. 선택 {value.length}개 · 최대 10개</span>
    </div>
  );
}

function ScenarioEditor({ target, types, tags, onClose, onSaved }: { target: Scenario | "new"; types: string[]; tags: string[]; onClose: () => void; onSaved: (s: Scenario, nearest: RagCandidate | null) => void }) {
  const isNew = target === "new";
  const [f, setF] = useState<ScenarioInput>(isNew ? EMPTY_INPUT : toInput(target));
  const [lines, setLines] = useState(f.범인멘트.join("\n"));
  const [signals, setSignals] = useState<string[]>(f.위험신호);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const input = (): ScenarioInput => ({
    ...f,
    범인멘트: lines.split("\n").map((x) => x.trim()).filter(Boolean),
    위험신호: signals,
  });

  const submit = async () => {
    const data = input();
    const errs = scenarioErrors(data);
    setErrors(errs);
    if (errs.length) return;
    setBusy(true);
    try {
      const res = await getAdminApi().saveScenario(isNew ? null : target.id, data, note.trim());
      onSaved(res.scenario, res.nearest);
    } catch (e) {
      setErrors(e instanceof ConfigError ? e.errors : [e instanceof Error ? e.message : "저장하지 못했어요."]);
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof ScenarioInput>(k: K, v: ScenarioInput[K]) => setF((x) => ({ ...x, [k]: v }));

  return (
    <Modal
      open
      kicker="본부 · 사례집 관리"
      theme="hq"
      title={isNew ? "새 사례 등록" : `${target.id} 사례 수정`}
      onClose={onClose}
      footer={
        <>
          <button className="c-btn" onClick={onClose}>
            취소
          </button>
          <button className="c-btn c-btn-primary" onClick={submit} disabled={busy}>
            {busy ? "저장 중…" : isNew ? "등록하고 검색에 반영" : "저장하고 검색에 반영"}
          </button>
        </>
      }
    >
      <div className="c-stack">
        <p className="c-muted c-small">수법 요약·범인 멘트·위험 신호를 합친 글이 유사도 계산에 쓰여요. 고객이 실제로 듣는 말투로 쓸수록 잘 잡혀요.</p>
        <div className="c-edit-grid">
          <Field label="유형" hint="같은 유형끼리 묶어 탐지 현황을 봐요">
            <input type="text" list="rag-types" value={f.유형} onChange={(e) => set("유형", e.target.value)} placeholder="예: 기관사칭" />
          </Field>
          <Field label="중분류(수법 이름)">
            <input type="text" value={f.중분류} onChange={(e) => set("중분류", e.target.value)} placeholder="예: 검찰청 사칭" />
          </Field>
          <Field label="위험도">
            <select value={f.위험도} onChange={(e) => set("위험도", e.target.value)}>
              <option value="고">고</option>
              <option value="중">중</option>
              <option value="저">저</option>
            </select>
          </Field>
          <Field label="출처">
            <input type="text" value={f.출처} onChange={(e) => set("출처", e.target.value)} />
          </Field>
        </div>
        <datalist id="rag-types">
          {types.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <Field label="수법 요약(시나리오)">
          <textarea rows={3} value={f.수법요약} onChange={(e) => set("수법요약", e.target.value)} placeholder="누가 무엇을 명목으로 접근해 어디로 돈을 보내게 하는지" />
        </Field>
        <Field label="범인 멘트" hint="한 줄에 하나씩, 최대 12줄">
          <textarea rows={4} value={lines} onChange={(e) => setLines(e.target.value)} placeholder={"OO지방검찰청 수사관입니다\n안전계좌로 이체하세요"} />
        </Field>
        <SignalPicker value={signals} onChange={setSignals} known={tags} />
        <Field label="변경 메모(선택)">
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 10월 신종 수법 반영" maxLength={200} />
        </Field>
        {errors.length > 0 && (
          <div className="c-note tone-danger" role="alert">
            {errors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function LibraryPage() {
  const api = getAdminApi();
  const [rev, setRev] = useState(0);
  const analysis = useLoad<AnalysisData>(loadAnalysisData, []);
  const rules = useLoad<RulesState>(() => api.getRules(), []);
  const scenarios = useLoad<Scenario[]>(() => api.getScenarios(), [rev]);
  const history = useLoad<ScenarioHistoryEntry[]>(() => api.getScenarioHistory(), [rev]);
  const evaluation = useLoad<RagEvalCase[]>(() => api.evaluateRag(), [rev]);
  const [tab, setTab] = useState<Tab>("list");
  const [period, setPeriod] = useState<Period>(() => periodOf("30"));
  const [typeFilter, setTypeFilter] = useState("all");
  const [open, setOpen] = useState<Scenario | null>(null);
  const [editing, setEditing] = useState<Scenario | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ text: string; candidates: RagCandidate[] | null } | null>(null);
  const [searching, setSearching] = useState(false);
  const { show, node } = useToast();

  const list = useMemo(() => scenarios.data ?? [], [scenarios.data]);
  const corpus = useMemo(() => new Map(list.map((s) => [s.id, s])), [list]);
  const g = rules.data?.config.global;
  const types = useMemo(() => [...new Set(list.map((s) => s.유형))], [list]);
  const tags = useMemo(() => [...new Set(list.flatMap((s) => s.위험신호))], [list]);
  const rows = useMemo(() => (analysis.data ? analysis.data.rows.filter((r) => inPeriod(r.log.at, period)) : []), [analysis.data, period]);
  const usage = useMemo(() => (g ? usageByScenario(rows, g) : new Map<string, ScenarioUsage>()), [rows, g]);
  const coverage = useMemo(() => (g ? coverageByType(rows, g, list) : []), [rows, g, list]);

  const evalSummary = useMemo(() => {
    if (!evaluation.data || !g) return null;
    const items = evaluation.data.map((c) => {
      const v = ragVerdict(c.candidates, g, corpus);
      const ok = c.expected == null ? v.strength === "none" : v.strength !== "none" && v.top?.matched_type === c.expected;
      return { ...c, v, ok };
    });
    const scam = items.filter((i) => i.expected != null);
    const normal = items.filter((i) => i.expected == null);
    return { items, ok: items.filter((i) => i.ok).length, scamOk: scam.filter((i) => i.ok).length, scam: scam.length, fp: normal.filter((i) => !i.ok).length, normal: normal.length };
  }, [evaluation.data, g, corpus]);

  if (scenarios.error) return <ErrorBox message={scenarios.error} onRetry={() => scenarios.reload()} />;
  if (!scenarios.data || !g || !analysis.data) return <Loading />;

  const active = list.filter((s) => s.enabled !== false);
  const matchedTotal = [...usage.values()].reduce((a, u) => a + u.matched, 0);
  const matchedFrauds = [...usage.values()].reduce((a, u) => a + u.frauds, 0);
  const weak = coverage.filter((c) => c.frauds > 0 && c.caught / c.frauds < WEAK_COVERAGE);
  const shown = typeFilter === "all" ? list : list.filter((s) => s.유형 === typeFilter);

  const runSearch = async (text: string) => {
    const t = text.trim();
    if (t.length < 2) return;
    setQuery(t);
    setTab("test");
    setSearching(true);
    try {
      setResult({ text: t, candidates: await api.searchRag(t) });
    } catch (e) {
      show(e instanceof Error ? e.message : "유사도를 계산하지 못했어요.", "danger");
    } finally {
      setSearching(false);
    }
  };

  const saved = (s: Scenario, nearest: RagCandidate | null) => {
    setEditing(null);
    setOpen(null);
    setRev((r) => r + 1);
    if (result) void runSearch(result.text);
    const near = nearest ? ` 가장 비슷한 기존 사례는 ${nearest.scenario_id}(${nearest.matched_type}, ${nearest.similarity.toFixed(2)})예요.` : "";
    const dup = nearest && nearest.similarity >= 0.9 ? " 내용이 거의 같아 중복일 수 있어요." : "";
    const applied = api.mode === "demo" ? " 데모에서는 새 내용의 유사도를 계산하지 않고, 로컬 모드에서 바로 반영돼요." : " 유사 사례 검색에 바로 반영돼요.";
    show(`${s.id} 사례를 저장했어요.${applied}${near}${dup}`, dup ? "warn" : "green");
  };

  const toggle = async (s: Scenario) => {
    try {
      await api.saveScenario(s.id, { ...toInput(s), enabled: s.enabled === false }, "");
      setRev((r) => r + 1);
      if (open?.id === s.id) setOpen(null);
      show(s.enabled === false ? `${s.id} 사례를 다시 검색에 써요.` : `${s.id} 사례를 검색에서 뺐어요. 기록은 남아 있어요.`);
    } catch (e) {
      show(e instanceof Error ? e.message : "바꾸지 못했어요.", "danger");
    }
  };

  return (
    <div className="console-content">
      {node}
      <PageHeader
        title="사례집 관리"
        sub={`${periodText(period)} · 2단계 유사 사례 검색(RAG)에 쓰는 보이스피싱 사례예요. 고치면 검색에 바로 반영돼요.`}
        actions={
          <>
            <PeriodFilter value={period} onChange={setPeriod} presets={PRESETS} />
            <button className="c-btn c-btn-primary" onClick={() => setEditing("new")}>
              + 사례 등록
            </button>
          </>
        }
      />

      <div className="c-kpis c-kpis-4">
        <Kpi label="사용 중인 사례" value={`${active.length} / ${list.length}`} sub={`유형 ${new Set(active.map((s) => s.유형)).size}개`} tone="green" />
        <Kpi
          label="검증 문장 점검"
          value={evalSummary ? `${evalSummary.ok} / ${evalSummary.items.length}` : "…"}
          sub={evalSummary ? `사기 ${evalSummary.scamOk}/${evalSummary.scam} · 정상 오탐 ${evalSummary.fp}` : "계산 중"}
          tone={evalSummary && evalSummary.ok === evalSummary.items.length ? "green" : "warn"}
          onClick={() => setTab("eval")}
        />
        <Kpi label="사례 매칭 거래" value={`${matchedTotal}건`} sub={`그중 사기 확인 ${matchedFrauds}건`} />
        <Kpi label="사례 보강 필요 유형" value={`${weak.length}개`} sub={weak.length ? weak.map((w) => w.type).join(", ") : `같은 유형 탐지율 ${pct(WEAK_COVERAGE)} 이상`} tone={weak.length ? "warn" : "default"} onClick={() => setTab("list")} />
      </div>

      <div className="c-tabs">
        <Segmented
          label="사례집 보기"
          value={tab}
          onChange={setTab}
          options={[
            { id: "list", label: "사례 목록·탐지 현황", count: list.length },
            { id: "test", label: "유사도 시험" },
            { id: "eval", label: "검증 문장 점검" },
            { id: "history", label: "변경 이력", count: history.data?.length ?? 0 },
          ]}
        />
      </div>

      <div className="c-stack" hidden={tab !== "list"}>
        <Card
          title="사례 목록"
          sub="행을 누르면 시나리오 전문을 보고 고칠 수 있어요. 매칭 거래는 이 사례가 1위로, 매칭 기준 이상 비슷했던 거래예요."
          actions={
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="유형 필터" className="c-select-sm">
              <option value="all">전체 유형</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          }
        >
          <div className="c-table-wrap">
            <table className="c-table c-library">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>유형 · 수법</th>
                  <th>위험 신호</th>
                  <th className="num">매칭 거래</th>
                  <th className="num" title="매칭된 거래 중 사기로 확인된 건 / 정상으로 확인된 건">
                    사기 / 정상
                  </th>
                  <th>최근 변경</th>
                  <th>검색 사용</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => {
                  const u = usage.get(s.id);
                  const off = s.enabled === false;
                  return (
                    <tr key={s.id} className={`clickable ${off ? "c-off" : ""}`} onClick={() => setOpen(s)}>
                      <td>
                        <b>{s.id}</b>
                      </td>
                      <td>
                        <div className="c-rule-name">
                          {s.중분류} <Badge tone={s.위험도 === "고" ? "danger" : s.위험도 === "중" ? "warn" : "muted"}>{s.유형}</Badge>
                        </div>
                        <div className="c-muted c-small c-clamp">{s.수법요약}</div>
                      </td>
                      <td>
                        <SignalChips signals={s.위험신호} />
                      </td>
                      <td className="num">{u?.matched ?? 0}</td>
                      <td className="num">
                        {u?.frauds ?? 0} / {u?.normals ?? 0}
                      </td>
                      <td className="c-small c-muted nowrap">{s.updated_at ? `${fmtShort(s.updated_at)} · ${s.updated_by ?? ""}` : "기본 사례"}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <label className="c-switch" title={off ? "검색에 다시 쓰기" : "검색에서 빼기"}>
                          <input type="checkbox" checked={!off} onChange={() => toggle(s)} aria-label={`${s.id} 검색 사용`} />
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="유형별 탐지 현황" sub={`사례 검색까지 간 사기 거래가 같은 유형 사례로 잡혔는지 봐요. 탐지율 ${pct(WEAK_COVERAGE)} 미만이면 사례 보강이 필요해요.`}>
          {coverage.some((c) => c.frauds > 0) ? (
            <>
              <BarRows
                rows={coverage
                  .filter((c) => c.frauds > 0 || c.scenarios > 0)
                  .map((c) => ({
                    label: c.type,
                    sub: `사례 ${c.scenarios}건${c.frauds && c.caught / c.frauds < WEAK_COVERAGE ? " · 보강 필요" : ""}`,
                    segments: [
                      { value: c.caught, tone: "green" as Tone, label: "같은 유형으로 탐지" },
                      { value: c.otherType, tone: "warn" as Tone, label: "다른 유형으로 매칭" },
                      { value: c.missed, tone: "danger" as Tone, label: "기준 미달(놓침)" },
                    ],
                    trailing: c.frauds ? `${pct(c.caught / c.frauds)} (${c.caught}/${c.frauds})` : "거래 없음",
                  }))}
              />
              <div className="c-legend">
                <span>
                  <i className="c-dot tone-green" />
                  같은 유형으로 탐지
                </span>
                <span>
                  <i className="c-dot tone-warn" />
                  다른 유형으로 매칭
                </span>
                <span>
                  <i className="c-dot tone-danger" />
                  기준 미달(놓침)
                </span>
              </div>
            </>
          ) : (
            <Empty>이 기간에 사례 검색까지 간 사기 거래가 없어요.</Empty>
          )}
        </Card>
      </div>

      <div className="c-stack" hidden={tab !== "test"}>
        <Card
          title="유사도 시험"
          sub="고객이 이렇게 말하면 사례집의 어느 사례와 얼마나 비슷한지, 상황 점수가 몇 점 붙는지 바로 확인해요."
          actions={
            <a className="c-btn c-btn-sm" href="#/admin/rules">
              매칭 기준값 조정 →
            </a>
          }
        >
          <div className="c-stack">
            <form
              className="c-rag-form"
              onSubmit={(e) => {
                e.preventDefault();
                void runSearch(query);
              }}
            >
              <textarea rows={2} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="고객 설명 예: 검찰 수사관이 제 계좌가 범죄에 연루됐다고 안전계좌로 옮기래요" maxLength={1000} />
              <button className="c-btn c-btn-primary" disabled={searching || query.trim().length < 2}>
                {searching ? "계산 중…" : "유사도 계산"}
              </button>
            </form>
            <div className="c-sample-row">
              <span className="c-muted c-small">예시 문장</span>
              {SAMPLES.map((t) => (
                <button key={t} type="button" className="c-chip-btn" onClick={() => void runSearch(t)} title={t}>
                  {t.length > 22 ? `${t.slice(0, 22)}…` : t}
                </button>
              ))}
            </div>
            {api.mode === "demo" && (
              <div className="c-note tone-blue c-small">
                데모 모드는 브라우저에서 문장을 계산할 수 없어서, 예시 문장과 검증 문장 {ragDemo.cases.length}개만 실제 엔진(한국어 SBERT + FAISS)으로 미리 계산한 결과를 보여줘요. 사용 중지는 바로 반영되지만, 새로
                등록·수정한 사례의 유사도는 로컬 모드에서 계산돼요.
              </div>
            )}
            {result &&
              (result.candidates ? (
                <>
                  <VerdictNote candidates={result.candidates} g={g} corpus={corpus} />
                  <div className="c-sim-legend c-small c-muted">
                    세로선: 매칭 기준 {g.rag_mid_sim}(+{g.rag_mid_score}점) · 강한 매칭 기준 {g.rag_high_sim}(+{g.rag_high_score}점)
                  </div>
                  <SimilarityList candidates={result.candidates} g={g} corpus={corpus} />
                </>
              ) : (
                <div className="c-note tone-warn">데모 모드에서는 이 문장의 유사도를 계산할 수 없어요. 위 예시 문장이나 검증 문장을 눌러 보세요.</div>
              ))}
          </div>
        </Card>
      </div>

      <div className="c-stack" hidden={tab !== "eval"}>
        <Card
          title="검증 문장 점검"
          sub="유형별 실제 고객 발화와 정상 송금 발화를 지금 사례집·기준값으로 다시 돌려요. 사례를 고친 뒤 성능이 떨어지지 않았는지 확인하는 용도예요."
          actions={
            <button className="c-btn c-btn-sm" onClick={() => evaluation.reload()} disabled={evaluation.loading}>
              {evaluation.loading ? "점검 중…" : "다시 점검"}
            </button>
          }
        >
          {evaluation.error ? (
            <ErrorBox message={evaluation.error} onRetry={() => evaluation.reload()} />
          ) : !evalSummary ? (
            <Loading text="검증 문장을 계산하는 중…" />
          ) : (
            <div className="c-stack">
              <div className={`c-note ${evalSummary.ok === evalSummary.items.length ? "tone-green" : "tone-warn"}`}>
                사기 발화 <b>{evalSummary.scamOk}/{evalSummary.scam}</b>건을 맞는 유형으로 잡았고, 정상 송금 발화 {evalSummary.normal}건 중 <b>{evalSummary.fp}건</b>을 사기로 잘못 매칭했어요.
              </div>
              <div className="c-table-wrap">
                <table className="c-table">
                  <thead>
                    <tr>
                      <th>결과</th>
                      <th>기대</th>
                      <th>문장</th>
                      <th>1위 사례</th>
                      <th className="num">유사도</th>
                      <th>매칭</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evalSummary.items.map((i) => (
                      <tr key={i.text} className="clickable" onClick={() => void runSearch(i.text)} title="눌러서 사례별 유사도 보기">
                        <td>{i.ok ? <Badge tone="green">통과</Badge> : <Badge tone="danger">{i.expected == null ? "오탐" : "놓침"}</Badge>}</td>
                        <td className="nowrap">{i.expected ?? <span className="c-muted">정상 송금</span>}</td>
                        <td>{i.text}</td>
                        <td className="nowrap">{i.v.top ? `${i.v.top.scenario_id} ${i.v.top.matched_type}` : "-"}</td>
                        <td className="num">{i.v.top ? i.v.top.similarity.toFixed(2) : "-"}</td>
                        <td>{i.v.strength !== "none" ? <Badge tone={STRENGTH[i.v.strength].tone}>{STRENGTH[i.v.strength].label}</Badge> : <span className="c-muted c-small">미달</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="c-stack" hidden={tab !== "history"}>
        <Card title="변경 이력" sub="사례 등록·수정·사용 중지 기록이에요. 바뀐 내용은 다음 검색부터 반영돼요.">
          {history.data && history.data.length ? (
            <div className="c-table-wrap">
              <table className="c-table">
                <thead>
                  <tr>
                    <th>일시</th>
                    <th>사례</th>
                    <th>변경</th>
                    <th>내용</th>
                    <th>메모</th>
                    <th>담당</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.map((h) => (
                    <tr key={h.version}>
                      <td className="nowrap">{fmtShort(h.at)}</td>
                      <td>
                        <b>{h.scenario_id}</b> <span className="c-muted c-small">{corpus.get(h.scenario_id)?.중분류}</span>
                      </td>
                      <td>
                        <Badge tone={h.action === "등록" ? "green" : h.action === "중지" ? "muted" : "blue"}>{h.action}</Badge>
                      </td>
                      <td className="c-small">{h.summary}</td>
                      <td className="c-small c-muted">{h.note || "-"}</td>
                      <td className="nowrap c-small">{h.actor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>아직 바꾼 사례가 없어요. 지금은 기본 사례 {list.length}건을 그대로 쓰고 있어요.</Empty>
          )}
        </Card>
      </div>

      <Drawer
        open={!!open}
        title={open ? `${open.id} ${open.중분류}` : ""}
        sub={open ? `${open.유형} · 위험도 ${open.위험도} · ${open.출처}${open.enabled === false ? " · 검색 중지" : ""}` : undefined}
        onClose={() => setOpen(null)}
        footer={
          open && (
            <>
              <button className="c-btn" onClick={() => toggle(open)}>
                {open.enabled === false ? "검색에 다시 사용" : "검색에서 빼기"}
              </button>
              <button className="c-btn" onClick={() => void runSearch([open.수법요약, ...open.범인멘트].join(" ")).then(() => setOpen(null))}>
                이 시나리오로 유사도 시험
              </button>
              <button className="c-btn c-btn-primary" onClick={() => setEditing(open)}>
                수정
              </button>
            </>
          )
        }
      >
        {open && (
          <div className="c-stack">
            <section>
              <h3 className="c-sec">수법 요약(시나리오)</h3>
              <p className="c-text-block">{open.수법요약}</p>
            </section>
            <section>
              <h3 className="c-sec">범인 멘트</h3>
              <ul className="c-quote-list">
                {open.범인멘트.map((m) => (
                  <li key={m}>“{m}”</li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="c-sec">위험 신호</h3>
              <SignalChips signals={open.위험신호} />
              {open.위험신호.some((s) => HARD_OVERRIDE_SIGNALS.has(s)) && <p className="c-muted c-small">빨간 신호가 있는 사례와 매칭되면 점수와 관계없이 바로 '위험' 판정이에요.</p>}
            </section>
            <section>
              <h3 className="c-sec">{periodText(period)} 매칭 현황</h3>
              <dl className="c-kv">
                <dt>매칭 거래</dt>
                <dd>{usage.get(open.id)?.matched ?? 0}건</dd>
                <dt>사기 확인</dt>
                <dd>{usage.get(open.id)?.frauds ?? 0}건</dd>
                <dt>정상 확인</dt>
                <dd>{usage.get(open.id)?.normals ?? 0}건</dd>
                <dt>최근 변경</dt>
                <dd>{open.updated_at ? `${fmtShort(open.updated_at)} · ${open.updated_by ?? ""}` : "기본 사례(변경 없음)"}</dd>
              </dl>
            </section>
          </div>
        )}
      </Drawer>

      {editing && <ScenarioEditor target={editing} types={types} tags={tags} onClose={() => setEditing(null)} onSaved={saved} />}
    </div>
  );
}
