import { useMemo, useState } from "react";
import { getAdminApi } from "../api";
import type { RulesState } from "../api/types";
import { loadAnalysisData, type AnalysisData } from "../data";
import { backtest } from "../engine/backtest";
import { findGaps, proposeTuning, requestText, suggestNewRules, summarizeFindings } from "../engine/ruleAnalysis";
import { byAge, byAmount, byHour, byProvince, byRegion, byScenario, hotSegments, overview, ruleStats, weeklyTrend, type Group, type Row } from "../engine/stats";
import { dayOf, pct, wonShort } from "../format";
import { Badge, BarRows, Card, Empty, ErrorBox, Kpi, Legend, Loading, PageHeader, Segmented, TrendChart, useLoad, useToast, type BarRow } from "../components/ui";

type Period = "all" | "28" | "14";

const riskRows = (groups: Group[], max?: number): { rows: BarRow[]; max: number } => {
  const top = max ?? Math.max(1, ...groups.map((g) => g.total));
  return {
    max: top,
    rows: groups.map((g) => ({
      label: g.key,
      sub: `${g.total}건`,
      segments: [
        { value: g.risk, tone: "danger", label: "위험" },
        { value: g.caution, tone: "warn", label: "주의" },
        { value: g.total - g.risk - g.caution, tone: "muted", label: "안전" },
      ],
      trailing: `${Math.round(g.riskRate * 100)}%`,
    })),
  };
};

function MiniBar({ value, tone }: { value: number; tone: "green" | "muted" }) {
  return (
    <span className="c-mini">
      <span className="c-mini-track">
        <span className={`c-bar-seg tone-${tone}`} style={{ width: `${Math.min(100, value * 100)}%` }} />
      </span>
      <b>{Math.round(value * 100)}%</b>
    </span>
  );
}

export default function StatsPage() {
  const data = useLoad<AnalysisData>(loadAnalysisData, []);
  const rules = useLoad<RulesState>(() => getAdminApi().getRules(), []);
  const [period, setPeriod] = useState<Period>("all");
  const [regionMode, setRegionMode] = useState<"province" | "city">("province");
  const [narrative, setNarrative] = useState<{ text: string; llm: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { show, node } = useToast();

  const all = data.data;
  const rows: Row[] = useMemo(() => {
    if (!all) return [];
    if (period === "all") return all.rows;
    const last = all.rows.reduce((m, r) => (r.log.at > m ? r.log.at : m), "");
    const cutoff = dayOf(new Date(new Date(last).getTime() - Number(period) * 86400_000).toISOString());
    return all.rows.filter((r) => dayOf(r.log.at) > cutoff);
  }, [all, period]);

  const view = useMemo(() => {
    if (!rows.length) return null;
    const ov = overview(rows);
    return {
      ov,
      trend: weeklyTrend(rows),
      age: byAge(rows),
      province: byProvince(rows),
      city: byRegion(rows).slice(0, 10),
      scenario: byScenario(rows),
      hour: byHour(rows),
      amount: byAmount(rows),
      segments: hotSegments(rows),
    };
  }, [rows]);

  const rs = rules.data;
  const ruleTable = useMemo(() => (rs && rows.length ? ruleStats(rows, rs.rules.map((r) => r.name)) : []), [rs, rows]);
  const gaps = useMemo(() => {
    if (!all || !rs) return [];
    const labels = new Map(rs.rules.map((r) => [r.name, r.label]));
    return findGaps(rows, all.scenarios, (s) => labels.get(s) ?? s);
  }, [all, rs, rows]);
  const ideas = useMemo(() => (all ? suggestNewRules(gaps, all.scenarios) : []), [all, gaps]);
  const confirmed = useMemo(() => (all ? all.cases.filter((c) => c.case.outcome === "fraud_confirmed") : []), [all]);

  if (data.loading && !all) return <div className="console-content"><Loading text="거래 로그를 분석하는 중…" /></div>;
  if (data.error || !all) return <div className="console-content"><ErrorBox message={data.error ?? "데이터를 불러오지 못했어요."} onRetry={() => void data.reload()} /></div>;
  if (!view) return <div className="console-content"><PageHeader title="통계 분석" /><Empty>선택한 기간에 거래 로그가 없어요.</Empty></div>;

  const { ov } = view;
  const first = rows.reduce((m, r) => (r.log.at < m ? r.log.at : m), rows[0].log.at);
  const last = rows.reduce((m, r) => (r.log.at > m ? r.log.at : m), rows[0].log.at);

  const makeNarrative = async () => {
    if (!rs) return;
    setBusy(true);
    try {
      const labeled = rows.filter((r) => r.truth).map((r) => r.log);
      const m = backtest(labeled, rs.config, rs.config, all.corpus, all.truthOf).base;
      const tune = proposeTuning(labeled, rs, rs.config, all.corpus, all.truthOf, 3);
      const fallback = summarizeFindings(m, tune, gaps, ideas) + (view.segments[0] ? ` 고객군으로는 ${view.segments[0].dim} '${view.segments[0].key}'의 사기 비율이 평균의 ${view.segments[0].lift.toFixed(1)}배로 높아요.` : "");
      const facts = {
        period: `${dayOf(first)}~${dayOf(last)}`,
        total: ov.total,
        risk: ov.risk,
        frauds: ov.frauds,
        caught: ov.caught,
        missed: ov.missed,
        hot_segments: view.segments.slice(0, 3).map((s) => ({ dim: s.dim, key: s.key, rate: Math.round(s.rate * 100), lift: Number(s.lift.toFixed(1)) })),
        weak_scenarios: gaps.slice(0, 3).map((g) => ({ type: g.type, not_caught: g.missed + g.cautionOnly })),
        confirmed_by_monitoring: confirmed.length,
      };
      const res = await getAdminApi().narrate("stats_analysis", facts, fallback);
      setNarrative({ text: res.text, llm: res.llm });
    } catch (e) {
      show(e instanceof Error ? e.message : "해석을 만들지 못했어요.", "danger");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      show("복사했어요.");
    } catch {
      show("복사하지 못했어요.", "danger");
    }
  };

  const ages = riskRows(view.age);
  const regions = riskRows(regionMode === "province" ? view.province : view.city);
  const hours = riskRows(view.hour);
  const amounts = riskRows(view.amount);

  return (
    <div className="console-content">
      <PageHeader
        title="통계 분석"
        sub={`${dayOf(first)} ~ ${dayOf(last)} 거래 ${ov.total}건의 판정 로그를 모아 어디가 위험하고 무엇이 부족한지 살펴봐요.`}
        actions={
          <Segmented
            label="기간"
            value={period}
            onChange={setPeriod}
            options={[
              { id: "all", label: "전체" },
              { id: "28", label: "최근 4주" },
              { id: "14", label: "최근 2주" },
            ]}
          />
        }
      />

      <div className="c-kpis">
        <Kpi label="전체 거래" value={ov.total} sub={`AI 질문 개입 ${ov.asked}건`} />
        <Kpi label="위험 판정" value={ov.risk} sub={`${pct(ov.risk / ov.total)} · 주의 ${ov.caution}건`} tone="danger" />
        <Kpi label="사기 탐지율" value={pct(ov.recall)} sub={`사기 ${ov.frauds}건 중 ${ov.caught}건을 위험으로 차단`} tone="green" />
        <Kpi label="놓친 사기" value={ov.missed} sub={`주의로만 통과 ${ov.cautionOnly}건 별도`} tone="warn" />
        <Kpi label="위험 판정 정확도" value={pct(ov.precision)} sub={`정상 거래 ${ov.falseRisk}건을 잘못 차단`} />
        <Kpi label="모니터링 확정 사기" value={confirmed.length} sub={`피해 시도액 ${wonShort(confirmed.reduce((s, c) => s + c.report.amount, 0))}`} tone="purple" />
      </div>

      <div className="c-stack">
        <div className="c-grid-2">
          <Card title="주간 추이" sub="막대는 전체 거래, 선은 위험 판정 건수예요.">
            <TrendChart points={view.trend.map((t) => ({ label: t.label, bars: t.total, line: t.risk }))} barLabel="전체 거래" lineLabel="위험 판정" />
          </Card>
          <Card title="판정 결과 vs 실제" sub="사후에 사기/정상으로 확정된 거래를 기준으로 비교했어요.">
            <table className="c-table c-confusion">
              <thead>
                <tr>
                  <th>실제 \ 판정</th>
                  <th className="num">안전</th>
                  <th className="num">주의</th>
                  <th className="num">위험</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <b>사기</b> <span className="c-muted c-small">{ov.frauds}건</span>
                  </td>
                  <td className="num c-cell-bad">{ov.missed}</td>
                  <td className="num c-cell-warn">{ov.cautionOnly}</td>
                  <td className="num c-cell-good">{ov.caught}</td>
                </tr>
                <tr>
                  <td>
                    <b>정상</b> <span className="c-muted c-small">{ov.total - ov.frauds}건</span>
                  </td>
                  <td className="num c-cell-good">{rows.filter((r) => r.truth === "normal" && r.final === "안전").length}</td>
                  <td className="num c-cell-warn">{rows.filter((r) => r.truth === "normal" && r.final === "주의").length}</td>
                  <td className="num c-cell-bad">{ov.falseRisk}</td>
                </tr>
              </tbody>
            </table>
            <p className="c-muted c-small" style={{ marginBottom: 0 }}>
              초록은 의도한 대로 판정된 칸, 빨강은 놓치거나 잘못 막은 칸이에요.
            </p>
          </Card>
        </div>

        <Card title="고위험 거래 분포" sub="막대는 해당 고객군의 거래 수이고 색은 판정(위험·주의·안전)이에요. 오른쪽 숫자는 위험 판정 비율이에요.">
          <Legend
            items={[
              { label: "위험", tone: "danger" },
              { label: "주의", tone: "warn" },
              { label: "안전", tone: "muted" },
            ]}
          />
          <div className="c-grid-2">
            <div>
              <h3 className="c-sec">연령대별</h3>
              <BarRows rows={ages.rows} max={ages.max} />
            </div>
            <div>
              <div className="c-sec-row">
                <h3 className="c-sec">지역별</h3>
                <Segmented
                  label="지역 단위"
                  value={regionMode}
                  onChange={setRegionMode}
                  options={[
                    { id: "province", label: "시·도" },
                    { id: "city", label: "시·군·구 TOP10" },
                  ]}
                />
              </div>
              <BarRows rows={regions.rows} max={regions.max} />
            </div>
          </div>
          <div className="c-grid-2" style={{ marginTop: 20 }}>
            <div>
              <h3 className="c-sec">시간대별</h3>
              <BarRows rows={hours.rows} max={hours.max} />
            </div>
            <div>
              <h3 className="c-sec">금액대별</h3>
              <BarRows rows={amounts.rows} max={amounts.max} />
            </div>
          </div>
        </Card>

        <div className="c-grid-2">
          <Card title="가장 많이 탐지된 사기 시나리오" sub="사기로 확정된 거래를 유형별로 나눠 탐지 결과를 비교했어요.">
            <Legend
              items={[
                { label: "위험으로 탐지", tone: "green" },
                { label: "주의로 통과", tone: "warn" },
                { label: "안전으로 놓침", tone: "danger" },
              ]}
            />
            <BarRows
              max={Math.max(1, ...view.scenario.map((s) => s.frauds))}
              rows={view.scenario.map((s) => ({
                label: s.key,
                sub: `${s.frauds}건`,
                segments: [
                  { value: s.caught, tone: "green", label: "탐지" },
                  { value: s.cautionOnly, tone: "warn", label: "주의" },
                  { value: s.missed, tone: "danger", label: "놓침" },
                ],
                trailing: `${Math.round((s.recall ?? 0) * 100)}%`,
              }))}
            />
          </Card>

          <Card title="룰별 효과" sub="사기 거래와 정상 거래에서 각 룰이 발동한 비율이에요. 사기에서만 높을수록 좋은 룰이에요.">
            <div className="c-table-wrap">
              <table className="c-table">
                <thead>
                  <tr>
                    <th>룰</th>
                    <th>사기 거래에서</th>
                    <th>정상 거래에서</th>
                    <th className="num">발동 시 사기 확률</th>
                  </tr>
                </thead>
                <tbody>
                  {ruleTable.map((r) => {
                    const info = rs?.rules.find((x) => x.name === r.signal);
                    return (
                      <tr key={r.signal}>
                        <td className="nowrap">
                          <b>{info?.rule_id}</b> {info?.label ?? r.signal}
                        </td>
                        <td>
                          <MiniBar value={r.fraudRate} tone="green" />
                        </td>
                        <td>
                          <MiniBar value={r.normalRate} tone="muted" />
                        </td>
                        <td className="num">{r.precision == null ? "-" : `${Math.round(r.precision * 100)}%`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <Card
          title="자가 개선 제안"
          sub="쌓인 로그와 모니터링에서 확정된 실제 사기 사례를 근거로, 보완할 점과 룰 제안을 정리해요."
          actions={
            <button className="c-btn c-btn-primary" onClick={() => void makeNarrative()} disabled={busy || !rs}>
              {busy ? "정리 중…" : narrative ? "✨ 다시 정리" : "✨ AI 해석 만들기"}
            </button>
          }
        >
          {narrative && (
            <div className="c-ai-summary" style={{ marginBottom: 16 }}>
              <div className="c-ai-badges">
                <Badge tone={narrative.llm === "ok" ? "purple" : "muted"}>{narrative.llm === "ok" ? "AI 해석" : narrative.llm === "demo" ? "규칙 기반 해석(데모)" : "규칙 기반 해석(AI 연결 불가)"}</Badge>
              </div>
              <p>{narrative.text}</p>
            </div>
          )}

          <div className="c-grid-2">
            <div>
              <h3 className="c-sec">① 보완이 필요한 시나리오</h3>
              {gaps.length === 0 ? (
                <Empty>모든 유형을 안정적으로 탐지하고 있어요.</Empty>
              ) : (
                <ul className="c-health">
                  {gaps.slice(0, 5).map((g) => (
                    <li key={g.type}>
                      <Badge tone={g.missed ? "danger" : "warn"}>{g.type}</Badge>
                      <span>
                        사기 {g.frauds}건 중 {g.caught}건 탐지({Math.round(g.recall * 100)}%){g.missed > 0 && `, ${g.missed}건은 안전으로 통과`}. {g.weakness}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="c-sec">② 사기 비율이 높은 고객군</h3>
              {view.segments.length === 0 ? (
                <Empty>평균보다 뚜렷하게 높은 고객군이 없어요.</Empty>
              ) : (
                <ul className="c-health">
                  {view.segments.slice(0, 5).map((s) => (
                    <li key={s.dim + s.key}>
                      <Badge tone="purple">{s.dim}</Badge>
                      <span>
                        <b>{s.key}</b> — 사기 비율 {Math.round(s.rate * 100)}%(평균의 {s.lift.toFixed(1)}배), {s.total}건 중 {s.frauds}건
                        {s.underCaught > 0 && `, 위험으로 못 잡은 사기 ${s.underCaught}건`}.
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="c-muted c-small">고객군을 겨냥한 가중 룰(예: 해당 연령대 + 신규 수취인일 때 가점)을 새 룰 후보로 검토해보세요.</p>
            </div>
          </div>

          <h3 className="c-sec" style={{ marginTop: 18 }}>③ 새 룰·조건 제안</h3>
          {ideas.length === 0 ? (
            <Empty>지금 놓치는 유형에 맞는 새 룰 후보가 없어요.</Empty>
          ) : (
            <ul className="c-ideas">
              {ideas.slice(0, 4).map((i) => (
                <li key={i.id}>
                  <div className="c-idea-head">
                    <strong>{i.name}</strong>
                    <Badge tone="blue">개발 필요</Badge>
                  </div>
                  <p>
                    {i.definition} — 보완 대상: {i.targets.map((t) => `${t.type}(${t.weak}건)`).join(", ")}
                  </p>
                  <button className="c-btn c-btn-sm" onClick={() => void copy(requestText(i))}>
                    개발 요청서 복사
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="c-muted c-small" style={{ marginBottom: 0 }}>
            임계값 조정안과 룰별 점검은 <a href="#/admin/rules">룰 관리 → AI 룰 분석</a>에서 이어서 확인하고 바로 적용할 수 있어요.
          </p>
        </Card>
      </div>
      {node}
    </div>
  );
}
