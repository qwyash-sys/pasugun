// AI 룰 분석: 쌓인 로그·모니터링 결과·사기 사례 말뭉치(RAG)로 룰의 부족한 점을 찾고 보완안을 낸다.
// 계산(조정안·공백 시나리오)은 규칙 코드가 하고, AI는 그 결과를 읽기 쉬운 설명문으로 풀어쓴다.
import { useState } from "react";
import { ConfigError, getAdminApi } from "../../api";
import type { RulesState } from "../../api/types";
import { findGaps, proposeTuning, requestText, ruleHealth, suggestNewRules, summarizeFindings, type GapScenario, type NewRuleIdea, type RuleHealth, type TuneProposal } from "../../engine/ruleAnalysis";
import { showValue } from "../../engine/configDiff";
import type { AnalysisData } from "../../data";
import { Badge, Card, Empty, Modal } from "../../components/ui";
import { ImpactTable } from "./ImpactTable";
import { backtest } from "../../engine/backtest";

interface Result {
  at: Date;
  summary: string;
  llm: "ok" | "fallback" | "demo";
  tune: TuneProposal[];
  health: RuleHealth[];
  gaps: GapScenario[];
  ideas: NewRuleIdea[];
}

const nextFrame = () => new Promise<void>((r) => setTimeout(r, 30));

export default function AiAnalysis({ state, data, onApplied, notify }: { state: RulesState; data: AnalysisData; onApplied: (s: RulesState) => void; notify: (t: string, tone?: "green" | "danger") => void }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [apply, setApply] = useState<TuneProposal | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setRunning(true);
    await nextFrame(); // '분석 중' 표시가 먼저 그려지도록
    try {
      const tune = proposeTuning(data.logs, state, state.config, data.corpus, data.truthOf);
      const health = ruleHealth(data.rows, state);
      const labels = new Map(state.rules.map((r) => [r.name, r.label]));
      const gaps = findGaps(data.rows, data.scenarios, (s) => labels.get(s) ?? s);
      const ideas = suggestNewRules(gaps, data.scenarios);
      const labeled = data.logs.filter((l) => data.truthOf(l));
      const m = backtest(labeled, state.config, state.config, data.corpus, data.truthOf).base;
      const fallback = summarizeFindings(m, tune, gaps, ideas);
      const facts = {
        analyzed: m.labeled,
        frauds: m.frauds,
        caught_as_risk: m.fraudRisk,
        passed_as_caution: m.fraudCaution,
        missed: m.fraudMissed,
        false_risk: m.falseRisk,
        top_tuning: tune.slice(0, 3).map((t) => ({ change: t.title, effect: t.reason })),
        weak_scenarios: gaps.slice(0, 4).map((g) => ({ type: g.type, frauds: g.frauds, not_caught: g.missed + g.cautionOnly, note: g.weakness })),
        new_rule_candidates: ideas.slice(0, 3).map((i) => i.name),
      };
      const narrative = await getAdminApi().narrate("rule_analysis", facts, fallback);
      setResult({ at: new Date(), summary: narrative.text, llm: narrative.llm, tune, health, gaps, ideas });
    } catch (e) {
      notify(e instanceof Error ? e.message : "분석하지 못했어요.", "danger");
    } finally {
      setRunning(false);
    }
  };

  const doApply = async () => {
    if (!apply) return;
    setBusy(true);
    try {
      const res = await getAdminApi().putRules(apply.config, `AI 룰 분석 제안 적용: ${apply.title}`);
      onApplied(res.state);
      notify("제안을 적용했어요. 변경 이력에서 되돌릴 수 있어요.");
      setApply(null);
      setResult((r) => (r ? { ...r, tune: r.tune.filter((t) => t.id !== apply.id) } : r));
    } catch (e) {
      notify(e instanceof ConfigError ? e.errors[0] : e instanceof Error ? e.message : "적용하지 못했어요.", "danger");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (idea: NewRuleIdea) => {
    try {
      await navigator.clipboard.writeText(requestText(idea));
      notify("개발 요청서를 복사했어요.");
    } catch {
      notify("복사하지 못했어요. 브라우저 권한을 확인해주세요.", "danger");
    }
  };

  return (
    <Card
      title="AI 룰 분석"
      sub="쌓인 거래 로그·모니터링 결과·사기 사례 말뭉치(RAG)를 보고 룰의 부족한 점을 찾아 보완안을 제안해요."
      actions={
        <button className="c-btn c-btn-primary" onClick={run} disabled={running}>
          {running ? "분석 중…" : result ? "다시 분석" : "✨ 지금 분석하기"}
        </button>
      }
    >
      {!result && !running && <Empty>‘지금 분석하기’를 누르면 현재 룰로 과거 거래 {data.logs.length}건을 다시 판정해 보고 개선안을 찾아요.</Empty>}
      {running && (
        <div className="c-loading" role="status">
          <span className="c-spinner" aria-hidden />
          과거 거래를 조건별로 다시 채점하며 더 나은 설정을 찾는 중…
        </div>
      )}
      {result && !running && (
        <div className="c-stack">
          <div className="c-ai-summary">
            <div className="c-ai-badges">
              <Badge tone={result.llm === "ok" ? "purple" : "muted"}>{result.llm === "ok" ? "AI 요약" : result.llm === "demo" ? "규칙 기반 요약(데모)" : "규칙 기반 요약(AI 연결 불가)"}</Badge>
              <span className="c-muted c-small">{result.at.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" })} 분석</span>
            </div>
            <p>{result.summary}</p>
          </div>

          <div>
            <h3 className="c-sec">① 조건·임계값 조정안</h3>
            {result.tune.length === 0 ? (
              <Empty>지금 설정에서 과거 거래 기준으로 뚜렷하게 더 나아지는 조정안이 없어요.</Empty>
            ) : (
              <ul className="c-proposals">
                {result.tune.map((t) => (
                  <li key={t.id}>
                    <div>
                      <strong>{t.title}</strong>
                      <p>{t.reason}</p>
                    </div>
                    <button className="c-btn c-btn-sm c-btn-primary" onClick={() => setApply(t)}>
                      미리보기·적용
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="c-sec">② 룰별 점검</h3>
            <ul className="c-health">
              {result.health.map((h) => (
                <li key={h.signal}>
                  <Badge tone={h.level === "warn" ? "warn" : h.level === "ok" ? "green" : "muted"}>{h.ruleId}</Badge>
                  <span>
                    <b>{h.label}</b> — {h.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="c-sec">③ 보완이 필요한 사기 시나리오</h3>
            {result.gaps.length === 0 ? (
              <Empty>모든 유형을 안정적으로 잡고 있어요.</Empty>
            ) : (
              <div className="c-table-wrap">
                <table className="c-table">
                  <thead>
                    <tr>
                      <th>유형</th>
                      <th className="num">사기</th>
                      <th className="num">위험으로 탐지</th>
                      <th className="num">주의 통과</th>
                      <th className="num">놓침</th>
                      <th>원인 단서</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.gaps.map((g) => (
                      <tr key={g.type}>
                        <td>
                          <b>{g.type}</b>
                        </td>
                        <td className="num">{g.frauds}건</td>
                        <td className="num">
                          {g.caught}건 ({Math.round(g.recall * 100)}%)
                        </td>
                        <td className="num">{g.cautionOnly}건</td>
                        <td className="num">{g.missed ? <b className="c-bad">{g.missed}건</b> : "0건"}</td>
                        <td className="c-small">{g.weakness}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h3 className="c-sec">④ 새 룰 후보 (사기 사례 말뭉치 기반)</h3>
            {result.ideas.length === 0 ? (
              <Empty>지금 놓치는 사기 유형에 맞는 새 룰 후보가 없어요.</Empty>
            ) : (
              <ul className="c-ideas">
                {result.ideas.map((i) => (
                  <li key={i.id}>
                    <div className="c-idea-head">
                      <strong>{i.name}</strong>
                      <Badge tone="blue">개발 필요</Badge>
                    </div>
                    <p>{i.definition}</p>
                    <dl className="c-kv">
                      <dt>제안 조건</dt>
                      <dd>{i.condition}</dd>
                      <dt>근거</dt>
                      <dd>
                        사기 사례 {i.corpusTotal}건 중 {i.corpusHits}건이 관련 위험신호({i.tags.slice(0, 4).join("·")})를 가져요
                      </dd>
                      <dt>보완 대상</dt>
                      <dd>{i.targets.map((t) => `${t.type}(못 잡은 ${t.weak}건)`).join(", ")}</dd>
                      <dt>필요 데이터</dt>
                      <dd>{i.dataNeeded}</dd>
                    </dl>
                    <button className="c-btn c-btn-sm" onClick={() => void copy(i)}>
                      개발 요청서 복사
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="c-muted c-small">새 룰은 새로운 데이터 연동이 필요해서 화면에서 바로 추가되지 않아요. 요청서로 개발팀에 전달하는 방식이에요.</p>
          </div>
        </div>
      )}

      <Modal
        open={!!apply}
        title="이 제안을 적용할까요?"
        onClose={() => setApply(null)}
        footer={
          <>
            <button className="c-btn" onClick={() => setApply(null)} disabled={busy}>
              취소
            </button>
            <button className="c-btn c-btn-primary" onClick={() => void doApply()} disabled={busy}>
              {busy ? "적용 중…" : "적용"}
            </button>
          </>
        }
      >
        {apply && (
          <>
            <ul className="c-change-list">
              {apply.changes.map((c) => (
                <li key={c.path}>
                  <span>{c.label}</span>
                  <b>
                    {showValue(c.from)} → {showValue(c.to)}
                  </b>
                </li>
              ))}
            </ul>
            <ImpactTable result={apply.impact} />
          </>
        )}
      </Modal>
    </Card>
  );
}

