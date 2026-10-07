// 룰 자체 분석. 쌓인 로그·사례와 사기 사례 말뭉치(RAG)를 근거로
//  (1) 지금 조건·임계값을 하나씩 바꿔 보며 더 나은 설정을 찾고(과거 거래 재채점),
//  (2) 룰이 못 잡는 사기 유형(보완 필요 시나리오)을 찾아 새 룰/조건 보완안을 제안한다.
// 숫자(건수·재현율·비용)는 전부 여기서 계산하고, AI는 이 결과를 읽기 쉬운 문장으로 풀어쓰는 일만 한다.
import type { ConfigChange, RuleConfig, RulesState, Scenario, TransferLog } from "../api/types";
import { backtest, type BacktestResult, type Metrics } from "./backtest";
import { diffConfig, getByPath, setByPath } from "./configDiff";
import { fmtNum, validateConfig } from "./validate";
import type { Row } from "./stats";

// ---------------------------------------------------------------- 1) 조건·임계값 조정안
export interface TuneProposal {
  id: string;
  title: string;
  reason: string;
  config: RuleConfig;
  changes: ConfigChange[];
  impact: BacktestResult;
  /** 비용 감소량(클수록 좋음) */
  gain: number;
}

/** 현재 값 주변(±40%, 최소 몇 칸)만 훑는 후보 값들. 한 번에 크게 바꾸는 제안은 과거 데이터에 과적합되기 쉬워서 제한한다. */
function candidates(spec: { min: number; max: number; step: number }, current: number): number[] {
  const window = Math.max(spec.step * 3, Math.abs(current) * 0.4);
  const lo = Math.max(spec.min, current - window);
  const hi = Math.min(spec.max, current + window);
  const stepN = Math.max(spec.step, window / 8);
  const out: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += stepN) out.push(Number((Math.round(v / spec.step) * spec.step).toFixed(4)));
  return [...new Set(out)].filter((v) => v >= spec.min && v <= spec.max);
}

export function describeShift(a: Metrics, b: Metrics): string {
  const parts: string[] = [];
  const d = (x: number, y: number, label: string) => {
    if (x !== y) parts.push(`${label} ${x}→${y}건`);
  };
  d(a.fraudMissed, b.fraudMissed, "놓친 사기");
  d(a.fraudCaution, b.fraudCaution, "주의로 통과한 사기");
  d(a.falseRisk, b.falseRisk, "정상 거래 차단");
  d(a.falseCaution, b.falseCaution, "정상 거래 주의");
  return parts.length ? `${parts.join(", ")}으로 바뀌어요.` : "판정 결과가 거의 같아요.";
}

export function proposeTuning(
  logs: TransferLog[],
  state: RulesState,
  cfg: RuleConfig,
  corpus: Map<string, Scenario>,
  truthOf: (l: TransferLog) => "fraud" | "normal" | null,
  limit = 5,
): TuneProposal[] {
  const labeled = logs.filter((l) => truthOf(l));
  if (labeled.length < 30) return [];
  const baseCost = backtest(labeled, cfg, cfg, corpus, truthOf).base.cost;
  const paths: { path: string; label: string; spec: { min: number; max: number; step: number } }[] = [];
  for (const g of state.global_params) paths.push({ path: `global.${g.key}`, label: `전역 · ${g.label}`, spec: g });
  for (const r of state.rules) for (const p of r.params) paths.push({ path: `rules.${r.name}.params.${p.key}`, label: `${r.rule_id} ${r.label} · ${p.label}`, spec: p });

  const found: TuneProposal[] = [];
  for (const { path, label, spec } of paths) {
    const current = getByPath(cfg, path) as number;
    let best: { value: number; cost: number; cfg: RuleConfig } | null = null;
    for (const v of candidates(spec, current)) {
      if (v === current) continue;
      const trial = setByPath(cfg, path, v);
      if (validateConfig(trial, state).list.length) continue;
      const res = backtest(labeled, cfg, trial, corpus, truthOf);
      // 놓친 사기가 늘어나는 변경은 비용이 줄어도 제안하지 않는다(안전 우선).
      if (res.next.fraudMissed > res.base.fraudMissed) continue;
      if (!best || res.next.cost < best.cost) best = { value: v, cost: res.next.cost, cfg: trial };
    }
    if (!best || baseCost - best.cost < 1.5) continue;
    const res = backtest(labeled, cfg, best.cfg, corpus, truthOf);
    found.push({
      id: path,
      title: `${label}: ${fmtNum(current)} → ${fmtNum(best.value)}`,
      reason: `이 값으로 바꾸면 과거 거래 ${labeled.length}건 기준으로 ${describeShift(res.base, res.next)}`,
      config: best.cfg,
      changes: diffConfig(cfg, best.cfg, state),
      impact: res,
      gain: baseCost - best.cost,
    });
  }
  return found.sort((a, b) => b.gain - a.gain).slice(0, limit);
}

// ---------------------------------------------------------------- 2) 룰 효용 점검
export interface RuleHealth {
  signal: string;
  ruleId: string;
  label: string;
  level: "ok" | "warn" | "info";
  message: string;
}

export function ruleHealth(rows: Row[], state: RulesState): RuleHealth[] {
  const labeled = rows.filter((r) => r.truth);
  return state.rules.map((rule) => {
    let hitFraud = 0;
    let hitNormal = 0;
    for (const r of labeled) {
      if (!r.log.signals.find((s) => s.signal === rule.name)?.hit) continue;
      if (r.truth === "fraud") hitFraud++;
      else hitNormal++;
    }
    const hits = hitFraud + hitNormal;
    const base = { signal: rule.name, ruleId: rule.rule_id, label: rule.label };
    if (!rule.enabled) return { ...base, level: "info" as const, message: "현재 사용 중지 상태예요." };
    if (hits === 0) return { ...base, level: "warn" as const, message: "분석 기간에 한 번도 발동하지 않았어요. 조건이 너무 엄격하거나 이 유형이 드물 수 있어요." };
    if (hitNormal / hits >= 0.6 && hits >= 8) return { ...base, level: "warn" as const, message: `발동 ${hits}건 중 ${Math.round((hitNormal / hits) * 100)}%가 정상 거래예요. 배점을 낮추거나 조건을 좁히는 게 좋아요.` };
    if (hitFraud / hits >= 0.6) return { ...base, level: "ok" as const, message: `발동 ${hits}건 중 ${Math.round((hitFraud / hits) * 100)}%가 실제 사기예요. 잘 작동 중이에요.` };
    return { ...base, level: "ok" as const, message: `발동 ${hits}건 (사기 ${hitFraud} · 정상 ${hitNormal}).` };
  });
}

// ---------------------------------------------------------------- 3) 보완 필요 시나리오 → 새 룰/조건 제안
export interface GapScenario {
  type: string;
  frauds: number;
  caught: number;
  cautionOnly: number;
  missed: number;
  recall: number;
  /** 놓치거나 주의로 통과한 건에서 가장 흔했던, 발동하지 않은 룰 */
  weakness: string;
  corpusTags: string[];
}

/** 말뭉치(RAG)의 사기 유형별 위험신호 태그 모음. */
export function tagsByType(corpus: Scenario[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const s of corpus) {
    const set = map.get(s.유형) ?? new Set<string>();
    s.위험신호.forEach((t) => set.add(t));
    map.set(s.유형, set);
  }
  return map;
}

export function findGaps(rows: Row[], corpus: Scenario[], labelOf: (signal: string) => string = (s) => s): GapScenario[] {
  const tags = tagsByType(corpus);
  const byType = new Map<string, Row[]>();
  for (const r of rows) {
    if (r.truth !== "fraud") continue;
    const key = r.log.scenario ?? "분류 없음";
    byType.set(key, [...(byType.get(key) ?? []), r]);
  }
  const gaps: GapScenario[] = [];
  for (const [type, list] of byType) {
    const caught = list.filter((r) => r.final === "위험").length;
    const cautionOnly = list.filter((r) => r.final === "주의").length;
    const missed = list.filter((r) => r.final === "안전").length;
    const recall = caught / list.length;
    if (recall >= 0.85 && missed === 0) continue;
    const weak = list.filter((r) => r.final !== "위험");
    const strong = list.filter((r) => r.final === "위험");
    // 잡은 건에서는 자주 발동하는데 못 잡은 건에서는 잘 발동하지 않는 룰 = 이 유형에서 보완할 룰
    const rate = (rs: Row[], sig: string) => (rs.length ? rs.filter((r) => r.log.signals.find((s) => s.signal === sig)?.hit).length / rs.length : 0);
    const sigs = [...new Set(list.flatMap((r) => r.log.signals.map((s) => s.signal)))];
    const best = sigs.map((sig) => ({ sig, a: rate(strong, sig), b: rate(weak, sig) })).sort((x, y) => y.a - y.b - (x.a - x.b))[0];
    const weakness =
      !weak.length ? "뚜렷한 공통점이 없어요."
      : strong.length && best && best.a - best.b >= 0.2
        ? `'${labelOf(best.sig)}' 룰이 위험으로 잡은 건에서는 ${Math.round(best.a * 100)}% 발동했지만 못 잡은 건에서는 ${Math.round(best.b * 100)}%만 발동했어요.`
        : "위험으로 잡은 건과 못 잡은 건 사이에 뚜렷하게 갈리는 룰이 없어요. 기존 룰로는 보이지 않는 신호일 수 있어요.";
    gaps.push({
      type,
      frauds: list.length,
      caught,
      cautionOnly,
      missed,
      recall,
      weakness,
      corpusTags: [...(tags.get(type) ?? [])],
    });
  }
  return gaps.sort((a, b) => b.missed + b.cautionOnly - (a.missed + a.cautionOnly));
}

export interface NewRuleIdea {
  id: string;
  name: string;
  definition: string;
  condition: string;
  /** 이 룰이 근거로 삼는 말뭉치 위험신호 태그 */
  tags: string[];
  /** 말뭉치 중 이 태그가 걸린 사례 수 */
  corpusHits: number;
  corpusTotal: number;
  /** 위험으로 못 잡은 사기가 있는 유형 중 이 룰이 겨냥하는 것 */
  targets: { type: string; weak: number }[];
  dataNeeded: string;
}

/** 지금 룰(R01~R08)이 직접 보지 못하는 위험신호를 겨냥한 새 룰 후보. 새 룰은 데이터 연동이 필요해서 '개발 요청'으로 다룬다. */
const IDEAS: Omit<NewRuleIdea, "corpusHits" | "corpusTotal" | "targets">[] = [
  { id: "N1", name: "통화 중 이체 시도", definition: "이체 화면 진입·실행 시점에 휴대폰이 통화 중인 상태", condition: "통화 중 + 신규 수취인 이체 시 가점", tags: ["통화지속강요", "수사기관사칭", "긴박감조성", "즉시송금요구"], dataNeeded: "앱의 통화 상태 정보(OS 권한)" },
  { id: "N2", name: "원격제어·화면공유 앱 실행", definition: "원격제어·화면공유 앱이 설치·실행 중인 기기", condition: "해당 앱 감지 시 즉시 차단 수준 가점", tags: ["원격제어앱", "화면유지요구", "악성앱설치"], dataNeeded: "기기 보안 모듈의 앱 목록·실행 상태" },
  { id: "N3", name: "신규 수취인 고액 첫 이체", definition: "과거 거래 이력이 없는 수취인에게 평소 대비 큰 금액을 처음 이체", condition: "신규 수취인이면서 평소 금액의 N배 이상", tags: ["선입금요구", "보증금명목", "예치금", "안전계좌"], dataNeeded: "고객별 수취인 이력" },
  { id: "N4", name: "대출·구인 연계 입금 직후 이체", definition: "대출 실행·구직 관련 입금 직후 다른 계좌로 이체", condition: "입금 후 N시간 이내 전액에 가까운 이체", tags: ["대환대출", "한도상향유도", "고수익미끼", "반복입금유도", "신용점수언급"], dataNeeded: "입금 거래 적요·대출 실행 이력" },
  { id: "N5", name: "피싱 링크 접속 후 인증정보 입력", definition: "문자·메신저 링크 접속 후 신분증·인증번호를 입력한 이력", condition: "링크 접속·인증정보 입력 후 이체 시도", tags: ["URL클릭유도", "결제정보입력", "신분증요구", "배송오류미끼"], dataNeeded: "모바일 보안 모듈의 피싱 URL 탐지 로그" },
  { id: "N6", name: "협박·긴급 표현 탐지", definition: "고객 입력·상담 내용에 납치·협박·유포 등 긴급 표현이 포함", condition: "2단계 입력문에서 위험 표현 탐지 시 가점", tags: ["납치협박", "영상유포협박", "합의금명목", "신고방해", "신고금지요구"], dataNeeded: "2단계 AI분석 입력문(이미 수집 중)" },
];

export function suggestNewRules(gaps: GapScenario[], corpus: Scenario[]): NewRuleIdea[] {
  return IDEAS.map((idea) => {
    const corpusHits = corpus.filter((s) => s.위험신호.some((t) => idea.tags.includes(t))).length;
    const targets = gaps
      .filter((g) => g.corpusTags.some((t) => idea.tags.includes(t)))
      .map((g) => ({ type: g.type, weak: g.missed + g.cautionOnly }))
      .filter((t) => t.weak > 0);
    return { ...idea, corpusHits, corpusTotal: corpus.length, targets };
  })
    .filter((i) => i.targets.length > 0)
    .sort((a, b) => b.targets.reduce((s, t) => s + t.weak, 0) - a.targets.reduce((s, t) => s + t.weak, 0));
}

/** 개발 요청서 형태의 텍스트(복사해서 전달하는 용도). */
export function requestText(idea: NewRuleIdea): string {
  return [
    `[신규 룰 개발 요청] ${idea.name}`,
    `- 정의: ${idea.definition}`,
    `- 조건: ${idea.condition}`,
    `- 필요 데이터: ${idea.dataNeeded}`,
    `- 근거: 사기 사례 말뭉치 ${idea.corpusTotal}건 중 ${idea.corpusHits}건이 관련 위험신호(${idea.tags.join("·")})를 가짐`,
    `- 보완 대상 유형: ${idea.targets.map((t) => `${t.type}(위험으로 못 잡은 ${t.weak}건)`).join(", ")}`,
  ].join("\n");
}

// ---------------------------------------------------------------- 4) 종합 문장(AI 연결이 없을 때 쓰는 규칙 기반 요약)
export function summarizeFindings(m: Metrics, tune: TuneProposal[], gaps: GapScenario[], ideas: NewRuleIdea[]): string {
  const lines: string[] = [];
  lines.push(`분석 대상 ${m.labeled}건(사기 ${m.frauds}건) 중 위험으로 잡은 사기는 ${m.fraudRisk}건(재현율 ${m.recall == null ? "-" : Math.round(m.recall * 100)}%)이고, 주의로 통과한 사기 ${m.fraudCaution}건·안전으로 놓친 사기 ${m.fraudMissed}건이에요.`);
  if (tune[0]) lines.push(`가장 효과가 큰 조정은 「${tune[0].title}」예요. ${tune[0].reason}`);
  else lines.push("지금 임계값은 과거 거래 기준으로 뚜렷하게 더 나아지는 조정안이 없어요.");
  if (gaps[0]) lines.push(`보완이 가장 필요한 유형은 '${gaps[0].type}'(사기 ${gaps[0].frauds}건 중 ${gaps[0].missed + gaps[0].cautionOnly}건을 위험으로 못 잡음)이에요. ${gaps[0].weakness}`);
  if (ideas[0]) lines.push(`새 룰 후보로는 「${ideas[0].name}」을 우선 검토해보세요 — ${ideas[0].targets.map((t) => t.type).join("·")} 유형의 놓친 건을 겨냥해요.`);
  return lines.join(" ");
}
