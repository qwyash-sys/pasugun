// 영향 미리보기: 같은 과거 거래를 '현재 설정'과 '바꿔 보려는 설정'으로 각각 다시 채점해 비교한다.
import type { CaseItem, RuleConfig, Scenario, TransferLog, Verdict } from "../api/types";
import { rescoreLog } from "./scoring";

/** 사후에 확정된 실제 사기 여부. 합성 시드는 로그에 들어 있고, 실제 운영 건은 모니터링 사례의 최종 결과로 정한다. */
export function makeTruthOf(cases: CaseItem[]): (log: TransferLog) => "fraud" | "normal" | null {
  const outcome = new Map(cases.map((c) => [c.case.report_id, c.case.outcome]));
  return (log) => {
    if (log.truth) return log.truth;
    const o = log.report_id ? outcome.get(log.report_id) : null;
    return o === "fraud_confirmed" ? "fraud" : o === "normal" ? "normal" : null;
  };
}

export interface Metrics {
  total: number;
  risk: number;
  caution: number;
  safe: number;
  labeled: number;
  frauds: number;
  fraudRisk: number; // 사기를 '위험'으로 잡음
  fraudCaution: number; // 사기를 '주의'로 통과시킴
  fraudMissed: number; // 사기를 '안전'으로 놓침
  normals: number;
  falseRisk: number; // 정상 거래를 '위험'으로 막음
  falseCaution: number;
  /** 사기를 위험으로 잡은 비율 / 위험 판정 중 실제 사기 비율 */
  recall: number | null;
  precision: number | null;
  /** 낮을수록 좋은 종합 비용(놓침 3 · 주의로 통과 1.5 · 정상을 위험으로 막음 1 · 정상에 주의 0.4). */
  cost: number;
}

export function computeMetrics(verdicts: Verdict[], truths: ("fraud" | "normal" | null)[]): Metrics {
  const m: Metrics = { total: verdicts.length, risk: 0, caution: 0, safe: 0, labeled: 0, frauds: 0, fraudRisk: 0, fraudCaution: 0, fraudMissed: 0, normals: 0, falseRisk: 0, falseCaution: 0, recall: null, precision: null, cost: 0 };
  verdicts.forEach((v, i) => {
    if (v === "위험") m.risk++;
    else if (v === "주의") m.caution++;
    else m.safe++;
    const t = truths[i];
    if (!t) return;
    m.labeled++;
    if (t === "fraud") {
      m.frauds++;
      if (v === "위험") m.fraudRisk++;
      else if (v === "주의") m.fraudCaution++;
      else m.fraudMissed++;
    } else {
      m.normals++;
      if (v === "위험") m.falseRisk++;
      else if (v === "주의") m.falseCaution++;
    }
  });
  m.recall = m.frauds ? m.fraudRisk / m.frauds : null;
  const labeledRisk = m.fraudRisk + m.falseRisk;
  m.precision = labeledRisk ? m.fraudRisk / labeledRisk : null;
  m.cost = 3 * m.fraudMissed + 1.5 * m.fraudCaution + 1 * m.falseRisk + 0.4 * m.falseCaution;
  return m;
}

export interface ChangedLog {
  log: TransferLog;
  from: Verdict;
  to: Verdict;
  truth: "fraud" | "normal" | null;
}

export interface BacktestResult {
  base: Metrics;
  next: Metrics;
  changed: ChangedLog[];
  /** from → to 건수 */
  transitions: Record<Verdict, Record<Verdict, number>>;
  /** 예전에 누가 어떤 값으로 판정했는지 모르는(원측값 없는) 신호가 있어 저장된 점수를 그대로 쓴 로그 수 */
  keptStoredScores: number;
}

const VERDICTS: Verdict[] = ["안전", "주의", "위험"];

export function backtest(
  logs: TransferLog[],
  base: RuleConfig,
  next: RuleConfig,
  corpus: Map<string, Scenario>,
  truthOf: (log: TransferLog) => "fraud" | "normal" | null,
): BacktestResult {
  const truths = logs.map(truthOf);
  const baseV: Verdict[] = [];
  const nextV: Verdict[] = [];
  const changed: ChangedLog[] = [];
  const transitions = Object.fromEntries(VERDICTS.map((a) => [a, Object.fromEntries(VERDICTS.map((b) => [b, 0]))])) as BacktestResult["transitions"];
  let keptStoredScores = 0;
  logs.forEach((log, i) => {
    const a = rescoreLog(log, base, corpus).final;
    const b = rescoreLog(log, next, corpus).final;
    baseV.push(a);
    nextV.push(b);
    transitions[a][b]++;
    if (a !== b) changed.push({ log, from: a, to: b, truth: truths[i] });
    if (log.signals.some((s) => s.value == null && s.signal !== "payee_freshness")) keptStoredScores++;
  });
  return { base: computeMetrics(baseV, truths), next: computeMetrics(nextV, truths), changed, transitions, keptStoredScores };
}

/** 서버의 실제 엔진으로 같은 설정을 돌린 정답지와 이 재채점이 일치하는지(개발·검증용). */
export function checkGolden(
  logs: TransferLog[],
  corpus: Map<string, Scenario>,
  golden: { configs: Record<string, RuleConfig>; results: Record<string, Record<string, [number, number | null, Verdict]>> },
): { config: string; checked: number; mismatches: { log_id: string; expected: unknown; got: unknown }[] }[] {
  return Object.entries(golden.configs).map(([name, cfg]) => {
    const mismatches: { log_id: string; expected: unknown; got: unknown }[] = [];
    for (const log of logs) {
      const r = rescoreLog(log, cfg, corpus);
      const exp = golden.results[name][log.log_id];
      if (!exp) continue;
      if (r.accountTotal !== exp[0] || r.contextTotal !== exp[1] || r.final !== exp[2]) {
        mismatches.push({ log_id: log.log_id, expected: exp, got: [r.accountTotal, r.contextTotal, r.final] });
      }
    }
    return { config: name, checked: logs.length, mismatches };
  });
}
