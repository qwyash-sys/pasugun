import { freshDemoReport } from "./demoStore";
import { recordDemoFinalize } from "./customerChoice";
import { API_BASE_URL, RESPONSE_SOURCE } from "../config";
import { findDemoCase } from "../demoData/cases";
import type {
  AnswerSubmission,
  ChatTurnRequest,
  ChatTurnResponse,
  FinalizeResponse,
  QuoteResponse,
  TransferQuoteRequest,
} from "../types";

export interface BackendClient {
  quote(req: TransferQuoteRequest): Promise<QuoteResponse>;
  submitAnswers(sessionId: string, answers: AnswerSubmission[]): Promise<void>;
  chatTurn(sessionId: string, req: ChatTurnRequest): Promise<ChatTurnResponse>;
  finalize(sessionId: string): Promise<FinalizeResponse>;
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

  async chatTurn(sessionId: string, req: ChatTurnRequest): Promise<ChatTurnResponse> {
    const res = await fetch(`${API_BASE_URL}/api/transfer/${sessionId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      // 4xx(깨진 이미지·빈 메시지·턴 초과 등)는 서버가 사용자에게 보여줄 안내를 준다 — 그대로 전달한다.
      const detail = res.status < 500 ? await res.json().then((b) => b?.detail, () => null) : null;
      throw Object.assign(new Error(`chat 실패: ${res.status}`), {
        userMessage: typeof detail === "string" ? detail : undefined,
      });
    }
    return res.json();
  }

  async finalize(sessionId: string): Promise<FinalizeResponse> {
    const res = await fetch(`${API_BASE_URL}/api/transfer/${sessionId}/finalize`, { method: "POST" });
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

  async chatTurn(): Promise<ChatTurnResponse> {
    // 데모 모드는 M5Chat이 항상 단일 제출 UI(DemoChat)를 쓰므로 호출되지 않는다.
    throw new Error("데모 모드에서는 멀티턴 대화를 사용하지 않습니다");
  }

  async finalize(): Promise<FinalizeResponse> {
    const c = findDemoCase(this.caseId);
    // 실제 모드와 같게: 위험이면 '지금' 기준 새 리포트 번호로 저장하고 모니터링에 '고객 선택 대기' 사례를 연다.
    const report = c.report ? freshDemoReport(c.report) : null;
    await recordDemoFinalize(
      {
        customerName: c.input.customerName,
        amount: c.input.amount,
        payeeAccount: c.input.payeeAccount,
        payeeBank: c.input.payeeBank,
        final: c.final,
        account: c.account,
        context: c.context,
        reportId: report?.report_id ?? null,
      },
      report,
    );
    return { final: c.final, agent_reply: c.agentReply, report, account: c.account, context: c.context };
  }
}

export function createBackendClient(demoCaseId?: string): BackendClient {
  if (RESPONSE_SOURCE === "demo") {
    if (!demoCaseId) throw new Error("demo 모드에는 demoCaseId가 필요합니다");
    return new DemoBackendClient(demoCaseId);
  }
  return new HttpBackendClient();
}
