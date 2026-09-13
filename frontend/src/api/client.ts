import { API_BASE_URL, RESPONSE_SOURCE } from "../config";
import { findDemoCase } from "../demoData/cases";
import type {
  AnswerSubmission,
  FinalizeRequest,
  FinalizeResponse,
  QuoteResponse,
  TransferQuoteRequest,
} from "../types";

export interface BackendClient {
  quote(req: TransferQuoteRequest): Promise<QuoteResponse>;
  submitAnswers(sessionId: string, answers: AnswerSubmission[]): Promise<void>;
  finalize(sessionId: string, req: FinalizeRequest): Promise<FinalizeResponse>;
}

class HttpBackendClient implements BackendClient {
  async quote(req: TransferQuoteRequest): Promise<QuoteResponse> {
    const res = await fetch(`${API_BASE_URL}/api/transfer/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`quote 실패: ${res.status}`);
    return res.json();
  }

  async submitAnswers(sessionId: string, answers: AnswerSubmission[]): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/api/transfer/${sessionId}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    if (!res.ok) throw new Error(`answers 실패: ${res.status}`);
  }

  async finalize(sessionId: string, req: FinalizeRequest): Promise<FinalizeResponse> {
    const res = await fetch(`${API_BASE_URL}/api/transfer/${sessionId}/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`finalize 실패: ${res.status}`);
    return res.json();
  }
}

/** demo 모드: 백엔드 호출 없이 SPEC 5장 시연 케이스를 그대로 재생한다.
 * 실제 입력(질문 답변·텍스트·첨부)은 화면 시연을 위해 받되 결과에는 반영하지 않는다 —
 * 발표 중 네트워크·LLM 상태와 무관하게 항상 같은 결과가 나와야 하기 때문. */
class DemoBackendClient implements BackendClient {
  private caseId: string;

  constructor(caseId: string) {
    this.caseId = caseId;
  }

  async quote(): Promise<QuoteResponse> {
    const c = findDemoCase(this.caseId);
    return {
      session_id: `demo-${c.id}`,
      customer_name: c.input.customerName,
      payee_name: c.input.payeeName,
      payee_bank: c.input.payeeBank,
      account: c.account,
      intervention:
        c.questions.length === 0
          ? "confirm_only"
          : c.questions.length === 1
            ? "empathy_question"
            : "empathy_question+safety_question",
      questions: c.questions,
    };
  }

  async submitAnswers(): Promise<void> {
    // 데모는 선택 내용과 무관하게 대본대로 진행한다.
  }

  async finalize(): Promise<FinalizeResponse> {
    const c = findDemoCase(this.caseId);
    return { final: c.final, agent_reply: c.agentReply, report: c.report, account: c.account, context: c.context };
  }
}

export function createBackendClient(demoCaseId?: string): BackendClient {
  if (RESPONSE_SOURCE === "demo") {
    if (!demoCaseId) throw new Error("demo 모드에는 demoCaseId가 필요합니다");
    return new DemoBackendClient(demoCaseId);
  }
  return new HttpBackendClient();
}
