import type {
  ActivityEvent, Analysis, Branch, CaseDoc, CaseItem, ConfigChange, ConfigHistoryEntry, ReportPayload, RagCandidate, RagEvalCase, RuleConfig, RulesState, Scenario, ScenarioHistoryEntry, ScenarioInput, ScenarioSaveResult, TransferLog,
} from "./types";

/** 설정 저장이 검증에서 거절됐을 때(서버 422 또는 화면 검증). errors는 사람이 읽는 문장 목록. */
export class ConfigError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(errors[0] ?? "설정이 올바르지 않아요.");
    this.errors = errors;
  }
}

export interface NarrativeResult {
  text: string;
  /** ok: AI가 씀 / fallback: AI 연결 장애로 규칙 기반 문장 / demo: 데모모드(규칙 기반 문장) */
  llm: "ok" | "fallback" | "demo";
}

export interface ReanalyzeResult {
  activity: ActivityEvent[];
  analysis: Analysis;
  llm: "ok" | "fallback" | "demo";
}

/** 관리자 페이지가 데이터를 가져오고 저장하는 창구. 서버가 있으면 백엔드(HttpAdminApi), 없으면 브라우저에
 * 저장되는 샘플 데이터(DemoAdminApi)를 쓰고, 화면 코드는 둘을 구분하지 않는다. */
export interface AdminApi {
  readonly mode: "demo" | "local";
  getRules(): Promise<RulesState>;
  putRules(config: RuleConfig, note?: string): Promise<{ state: RulesState; changes: ConfigChange[] }>;
  resetRules(): Promise<RulesState>;
  getRuleHistory(): Promise<ConfigHistoryEntry[]>;
  getLogs(): Promise<TransferLog[]>;
  getScenarios(): Promise<Scenario[]>;
  /** 사례 등록(id 없음) 또는 수정·사용 여부 변경. 저장 즉시 유사 사례 검색에 반영된다. */
  saveScenario(id: string | null, input: ScenarioInput, note?: string): Promise<ScenarioSaveResult>;
  getScenarioHistory(): Promise<ScenarioHistoryEntry[]>;
  /** 유사도 시험: 이 문장과 사용 중인 사례 전체의 유사도 순위. 데모 모드에서 계산할 수 없는 문장이면 null. */
  searchRag(text: string): Promise<RagCandidate[] | null>;
  /** 검증 문장 세트를 지금 사례집으로 다시 돌린 결과. */
  evaluateRag(): Promise<RagEvalCase[]>;
  /** 영업점과 담당 준법감시책임자 목록. */
  listBranches(): Promise<Branch[]>;
  listCases(): Promise<CaseItem[]>;
  getCase(id: string): Promise<{ case: CaseDoc; report: ReportPayload }>;
  saveCase(doc: CaseDoc): Promise<CaseDoc>;
  reanalyze(caseId: string): Promise<ReanalyzeResult>;
  narrate(task: string, facts: Record<string, unknown>, fallback: string): Promise<NarrativeResult>;
  /** 데모 전용: 신규 위험 거래가 들어온 것처럼 사례를 하나 추가한다(서버 모드는 실제 고객 흐름으로 들어온다). */
  simulateIncoming?(): Promise<CaseDoc>;
}
