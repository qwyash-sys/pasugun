// 관리자 페이지가 주고받는 데이터 모양. backend/app/{rule_config,transfer_log,case_store}.py와 같은 구조다.
import type { ReportPayload, ReportSummary } from "../../types";

export type Verdict = "안전" | "주의" | "위험";
export type Level = "저" | "중" | "고";

// ---------------------------------------------------------------- 룰 설정
export interface ParamSpec {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  kind: "score" | "threshold";
  help: string;
}

export interface RuleConfig {
  global: Record<string, number>;
  rules: Record<string, { enabled: boolean; params: Record<string, number> }>;
}

/** [작은 쪽 키, 큰 쪽 키, 같아도 되는지] */
export type OrderRule = [string, string, boolean];

export interface RuleSchema {
  rules: Record<string, ParamSpec[]>;
  global: ParamSpec[];
  order: { rules: Record<string, OrderRule[]>; global: OrderRule[] };
}

export interface RuleInfo {
  name: string;
  rule_id: string;
  label: string;
  definition: string;
  condition: string;
  scoring: string;
  enabled: boolean;
  max_score: number;
  params: ParamSpec[];
}

export interface RulesState {
  version: number;
  config: RuleConfig;
  defaults: RuleConfig;
  global_params: ParamSpec[];
  rules: RuleInfo[];
  /** 입력 검증용 스키마(전역 파라미터 + 순서 제약). 서버·데모 모두 같은 모양으로 내려준다. */
  schema?: RuleSchema;
}

export interface ConfigChange {
  path: string;
  label: string;
  from: number | boolean;
  to: number | boolean;
}

export interface ConfigHistoryEntry {
  id: string;
  version: number;
  at: string;
  actor: string;
  note: string;
  summary: string;
  changes: ConfigChange[];
}

// ---------------------------------------------------------------- 거래 로그
export interface LogSignal {
  signal: string;
  value: number | null;
  score: number;
  hit: boolean;
}

export interface TransferLog {
  log_id: string;
  at: string;
  customer_id: string;
  customer_age_group: string;
  customer_region: string;
  amount: number;
  payee_account: string;
  payee_bank: string;
  usual_hours: number[];
  signals: LogSignal[];
  account_total: number;
  account_level: Level;
  asked: boolean;
  answers_empathy: number | null;
  answers_safety: number | null;
  answer_hard: boolean;
  input_used: boolean;
  rag_id: string | null;
  rag_type: string | null;
  rag_similarity: number | null;
  context_total: number | null;
  context_level: Level;
  hard_override: boolean;
  final: Verdict;
  report_id: string | null;
  truth: "fraud" | "normal" | null;
  scenario: string | null;
}

export interface Scenario {
  id: string;
  유형: string;
  중분류: string;
  수법요약: string;
  범인멘트: string[];
  위험신호: string[];
  위험도: string;
  출처: string;
  /** false면 유사 사례 검색에서 빠진다(기록은 남는다). 시드 사례는 값이 없을 수 있어 없으면 사용 중. */
  enabled?: boolean;
  updated_at?: string | null;
  updated_by?: string | null;
}

/** 관리자가 사례를 등록·수정할 때 보내는 내용(번호·이력은 서버가 붙인다). */
export type ScenarioInput = Pick<Scenario, "유형" | "중분류" | "수법요약" | "범인멘트" | "위험신호" | "위험도" | "출처"> & { enabled: boolean };

/** 유사 사례 검색이 비교한 사례 1건(유사도 높은 순). */
export interface RagCandidate {
  scenario_id: string;
  matched_type: string;
  similarity: number;
}

export interface RagEvalCase {
  /** 기대 유형. null = 정상 송금 문장(매칭되면 오탐) */
  expected: string | null;
  text: string;
  candidates: RagCandidate[];
}

export interface ScenarioHistoryEntry {
  version: number;
  at: string;
  actor: string;
  note: string;
  scenario_id: string;
  action: "등록" | "수정" | "중지" | "사용";
  summary: string;
}

export interface ScenarioSaveResult {
  scenario: Scenario;
  /** 저장한 사례와 가장 비슷한 다른 사례(중복 확인용). 데모 모드는 계산할 수 없어 null. */
  nearest: RagCandidate | null;
}

// ---------------------------------------------------------------- 모니터링 사례
export type CaseChoice = "visit" | "delayed" | "abandoned" | "pending";
export type Outcome = "fraud_confirmed" | "normal" | "unresolved";
export type Severity = "초고위험" | "고위험";

export interface Person {
  name: string;
  title: string;
}

export interface TimelineEvent {
  at: string;
  actor: string;
  kind: string;
  text: string;
}

export interface Interview {
  written_at: string;
  result: "fraud_signs" | "normal" | "no_show";
  action: "payment_stop" | "guide" | "none";
  memo: string;
}

export interface VisitInfo {
  branch: string;
  branch_code: string;
  reserved_at: string;
  officer: Person;
  mail: { sent_at: string; to: string; subject: string };
  interview: Interview | null;
  hq_confirmed_at: string | null;
}

export interface DelayedInfo {
  delay_until: string;
  decision: { type: "approve" | "reconfirm" | "hold"; at: string; by: string; note: string } | null;
  reconfirm: { requested_at: string; result: "intent_confirmed" | "victim_aware" | null; at: string | null; note: string } | null;
  executed_at: string | null;
}

export interface ActivityEvent {
  at: string;
  kind: "in" | "split" | "atm" | "overseas" | "report" | "normal_use" | "hold";
  text: string;
  amount?: number | null;
}

export interface Analysis {
  at: string;
  verdict: "정상 가능성 높음" | "추가 확인 필요" | "사기 의심";
  confidence: number;
  evidence: string[];
  narrative: string;
  action: string;
  source: "ai" | "rule" | "seed";
}

export interface PostCheck {
  required: boolean;
  activity: ActivityEvent[];
  analysis: Analysis | null;
  confirmed_at: string | null;
}

export interface CaseDoc {
  case_id: string;
  report_id: string;
  created_at: string;
  updated_at: string;
  choice: CaseChoice;
  severity: Severity;
  status: string;
  outcome: Outcome | null;
  outcome_at: string | null;
  assignee: Person | null;
  visit: VisitInfo | null;
  delayed: DelayedInfo | null;
  postcheck: PostCheck | null;
  /** 고객이 결과·취소 화면에서 112(경찰)·1332(콜센터) 안내를 확인한 기록(예전 데이터에는 없을 수 있다). */
  hotlines?: ("112" | "1332")[];
  timeline: TimelineEvent[];
}

export interface CaseItem {
  case: CaseDoc;
  report: ReportSummary;
}

export interface Branch {
  code: string;
  name: string;
  region: string;
  officer: Person;
}

export type { ReportPayload, ReportSummary };
