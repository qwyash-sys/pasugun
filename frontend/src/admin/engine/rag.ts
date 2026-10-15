// 사례집(RAG) 관리 화면의 계산: 유사도 → 점수·매칭 판단, 사례 입력 검증, 거래 로그 기준 사례별·유형별 탐지 현황.
// 점수 공식은 서버(scoring.rag_score)·영향 미리보기(ragScoreOf)와 같다.
import type { RagCandidate, Scenario, ScenarioInput } from "../api/types";
import { HARD_OVERRIDE_SIGNALS, ragScoreOf } from "./scoring";
import type { Row } from "./stats";

type Params = Record<string, number>;

export type RagStrength = "strong" | "match" | "none";

export interface RagVerdict {
  top: RagCandidate | null;
  strength: RagStrength;
  score: number;
  /** 1위 사례에 '결정적 피싱 징후' 신호가 있어 매칭되면 바로 위험이 되는지 */
  hardSignals: string[];
}

export const strengthOf = (similarity: number, g: Params): RagStrength =>
  similarity >= g.rag_high_sim ? "strong" : similarity >= g.rag_mid_sim ? "match" : "none";

export function ragVerdict(candidates: RagCandidate[], g: Params, corpus: Map<string, Scenario>): RagVerdict {
  const top = candidates[0] ?? null;
  if (!top) return { top: null, strength: "none", score: 0, hardSignals: [] };
  const strength = strengthOf(top.similarity, g);
  const hardSignals = strength === "none" ? [] : (corpus.get(top.scenario_id)?.위험신호 ?? []).filter((s) => HARD_OVERRIDE_SIGNALS.has(s));
  return { top, strength, score: ragScoreOf(top.similarity, g), hardSignals };
}

/** 서버(ScenarioInput)와 같은 입력 규칙. 빈 줄은 지우고 본다. */
export function scenarioErrors(input: ScenarioInput): string[] {
  const errors: string[] = [];
  const lines = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);
  if (!input.유형.trim()) errors.push("유형을 입력해 주세요.");
  else if (input.유형.trim().length > 20) errors.push("유형은 20자 이내로 입력해 주세요.");
  if (!input.중분류.trim()) errors.push("중분류(수법 이름)를 입력해 주세요.");
  else if (input.중분류.trim().length > 40) errors.push("중분류는 40자 이내로 입력해 주세요.");
  const summary = input.수법요약.trim().length;
  if (summary < 10) errors.push("수법 요약을 10자 이상 써 주세요. 유사도 계산의 중심이 되는 내용이에요.");
  else if (summary > 600) errors.push("수법 요약은 600자 이내로 써 주세요.");
  const lines1 = lines(input.범인멘트);
  if (!lines1.length) errors.push("범인 멘트를 한 줄 이상 입력해 주세요.");
  else if (lines1.length > 12) errors.push("범인 멘트는 12줄까지 입력할 수 있어요.");
  if (lines1.some((x) => x.length > 120)) errors.push("한 줄은 120자 이내로 입력해 주세요.");
  const unknown = input.위험신호.filter((x) => !HARD_OVERRIDE_SIGNALS.has(x));
  if (unknown.length) errors.push(`결정적 피싱 징후가 아니에요: ${unknown.join(", ")}`);
  if (!input.출처.trim()) errors.push("출처를 입력해 주세요.");
  return errors;
}

export interface ScenarioUsage {
  /** 이 사례가 1위로 매칭된 거래(현재 기준 유사도 이상) */
  matched: number;
  /** 그중 사기로 확인된 거래 */
  frauds: number;
  /** 그중 정상으로 확인된 거래(오탐) */
  normals: number;
}

/** AI 대화까지 가서 사례 검색을 한 거래만 본다(질문 단계에서 끝난 거래는 RAG를 쓰지 않았다). */
const searched = (r: Row): boolean => r.log.input_used && r.log.rag_similarity != null;

export function usageByScenario(rows: Row[], g: Params): Map<string, ScenarioUsage> {
  const out = new Map<string, ScenarioUsage>();
  for (const r of rows) {
    if (!searched(r) || !r.log.rag_id || (r.log.rag_similarity ?? 0) < g.rag_mid_sim) continue;
    const u = out.get(r.log.rag_id) ?? { matched: 0, frauds: 0, normals: 0 };
    u.matched += 1;
    if (r.truth === "fraud") u.frauds += 1;
    if (r.truth === "normal") u.normals += 1;
    out.set(r.log.rag_id, u);
  }
  return out;
}

export interface TypeCoverage {
  type: string;
  /** 사례 검색까지 간 사기 거래 */
  frauds: number;
  /** 같은 유형 사례로 매칭 */
  caught: number;
  /** 다른 유형 사례로 매칭(위험 점수는 받지만 근거 설명이 어긋남) */
  otherType: number;
  /** 기준 유사도 미달 */
  missed: number;
  /** 이 유형으로 등록된 사용 중 사례 수 */
  scenarios: number;
}

export function coverageByType(rows: Row[], g: Params, scenarios: Scenario[]): TypeCoverage[] {
  const types = new Map<string, TypeCoverage>();
  const get = (type: string) => {
    let t = types.get(type);
    if (!t) types.set(type, (t = { type, frauds: 0, caught: 0, otherType: 0, missed: 0, scenarios: 0 }));
    return t;
  };
  for (const s of scenarios) if (s.enabled !== false) get(s.유형).scenarios += 1;
  for (const r of rows) {
    if (r.truth !== "fraud" || !searched(r) || !r.log.scenario) continue;
    const t = get(r.log.scenario);
    t.frauds += 1;
    if ((r.log.rag_similarity ?? 0) < g.rag_mid_sim) t.missed += 1;
    else if (r.log.rag_type === r.log.scenario) t.caught += 1;
    else t.otherType += 1;
  }
  return [...types.values()].sort((a, b) => b.frauds - a.frauds || a.type.localeCompare(b.type));
}

/** 유형 탐지율이 이보다 낮으면 '사례 보강 필요'로 표시한다. */
export const WEAK_COVERAGE = 0.6;
