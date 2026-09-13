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

export interface RagMatch {
  signal: string;
  hit: boolean;
  matched_type: string | null;
  matched_id: string | null;
  similarity: number;
  score: number;
  risk_signals: string[];
  source: string | null;
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

export interface FinalizeRequest {
  text?: string;
  attachment_base64?: string | null;
  skipped?: boolean;
}
