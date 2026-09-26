// backend/app/models.py 와 대응하는 타입들.

export type RiskLevel = "저" | "중" | "고";
export type FinalVerdict = "안전" | "주의" | "위험";
export type Intervention = "confirm_only" | "empathy_question" | "empathy_question+safety_question";

export interface SignalResult {
  signal: string;
  hit: boolean;
  score: number;
  detail: string;
}

export interface AccountAssessment {
  signals: SignalResult[];
  total_score: number;
  level: RiskLevel;
}

export interface QuestionChoice {
  choice_id: string;
  label: string;
  weight: number;
  hard_override: boolean;
}

export interface Question {
  question_id: string;
  prompt: string;
  choices: QuestionChoice[];
}

export interface QuoteResponse {
  session_id: string;
  customer_name: string;
  payee_name: string;
  payee_bank: string;
  account: AccountAssessment;
  intervention: Intervention;
  questions: Question[];
}

export interface RagCandidate {
  scenario_id: string;
  matched_type: string;
  similarity: number;
}

export interface RagMatch {
  signal: string;
  hit: boolean;
  matched_type: string | null;
  matched_id: string | null;
  similarity: number;
  score: number;
  risk_signals: string[];
  source: string | null;
  candidates: RagCandidate[];
}

export interface FinalRisk {
  account_level: RiskLevel;
  context_level: RiskLevel;
  final: FinalVerdict;
  hard_override: boolean;
  reasons: string[];
  action: string;
}

export interface ContextAnswerOut {
  question_id: string;
  choice_id: string;
  choice_weight: number;
  hard_override: boolean;
}

export interface ContextAssessment {
  answers: ContextAnswerOut[];
  used_input_or_attachment: boolean;
  rag: RagMatch | null;
  total_score: number;
  level: RiskLevel;
  hard_override: boolean;
}

export interface AttachmentMeta {
  name: string;
  /** 실제 모드: "/api/reports/{id}/attachments/{i}"(API 주소 기준 상대경로). 데모: data: URL. */
  url: string;
}

export interface ReportPayload {
  report_id: string;
  generated_at: string;
  customer_name: string;
  customer_phone_masked: string;
  customer_account_masked: string;
  payee_bank: string;
  payee_account: string;
  payee_name: string;
  amount: number;
  attempted_at: string;
  final: FinalRisk;
  account_reasons: string[];
  conversation_summary: string;
  attachments_present: boolean;
  rag: RagMatch | null;
  recommendation: string;
  account: AccountAssessment;
  context: ContextAssessment | null;
  attachments: AttachmentMeta[];
}

/** 관리자 리포트 목록 한 줄(backend ReportSummary와 대응). */
export interface ReportSummary {
  report_id: string;
  attempted_at: string;
  customer_name: string;
  payee_bank: string;
  payee_name: string;
  amount: number;
  account_score: number;
  account_level: RiskLevel;
  context_score: number | null;
  context_level: RiskLevel;
  hard_override: boolean;
  rag_type: string | null;
  rag_similarity: number | null;
  attachment_count: number;
}

export interface ReportListResponse {
  items: ReportSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface ReportQuery {
  q: string;
  account_level: RiskLevel | "";
  context_level: RiskLevel | "";
  /** "" 전체, "none" RAG 매칭 없음, 그 외 사례 유형명 */
  rag_type: string;
  date_from: string;
  date_to: string;
  page: number;
  page_size: number;
}

export interface FinalizeResponse {
  final: FinalRisk;
  agent_reply: string | null;
  report: ReportPayload | null;
  account: AccountAssessment;
  context: ContextAssessment | null;
}

export interface AnswerSubmission {
  question_id: string;
  choice_id: string;
}

export interface TransferQuoteRequest {
  customer_id: string;
  payee_account: string;
  amount: number;
  current_time: string;
  context_overrides?: Partial<{
    fund_source_recent: boolean;
    limit_changed_recent: boolean;
    device_new: boolean;
    velocity_recent_count: number;
  }>;
}

export interface ChatTurnRequest {
  text?: string;
  attachments?: { name: string; base64: string }[];
}

export interface ChatTurnResponse {
  reply: string;
  turn: number;
  max_turns: number;
}
