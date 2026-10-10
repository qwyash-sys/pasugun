// 위험 결과 화면에서 고객이 고른 분기(영업점 내방 예약 / 지연송금 / 송금 중단, 그리고 지연이체 취소)를
// 본부 모니터링에 알린다. 실제 모드는 백엔드가 사례를 갱신하고, 데모 모드는 이 브라우저의 관리자 페이지
// 데이터에 같은 방식으로 남는다. 알리는 데 실패해도 고객 흐름은 절대 막지 않는다(조용히 무시).
import { API_BASE_URL, RESPONSE_SOURCE } from "../config";
import type { ReportPayload } from "../types";

export type CustomerChoice = "visit" | "delayed" | "abandoned" | "cancel_delayed";

/** 데모 전용: 결과 화면에 들어온 순간(서버의 finalize와 같은 시점) 판정을 거래 로그로 남기고,
 * '위험'이면 리포트를 저장한 뒤 '고객 선택 대기' 사례를 연다. */
export async function recordDemoFinalize(log: Parameters<typeof import("../admin/api/demoApi").logDemoDecision>[0], report: ReportPayload | null): Promise<void> {
  try {
    const demo = await import("../admin/api/demoApi");
    demo.logDemoDecision(log);
    if (report) await demo.openDemoCase(report);
  } catch {
    /* 모니터링 기록 실패가 송금 흐름을 막으면 안 된다 */
  }
}

export async function recordCustomerChoice(args: {
  sessionId: string | null;
  report: ReportPayload | null;
  choice: CustomerChoice;
  branch?: string;
  reservedAt?: string;
}): Promise<void> {
  if (!args.report) return; // 위험이 아닌 건은 모니터링 대상이 아니다
  try {
    if (RESPONSE_SOURCE === "demo") {
      const demo = await import("../admin/api/demoApi");
      if (args.choice === "cancel_delayed") await demo.cancelDemoDelayed(args.report.report_id);
      else await demo.recordDemoChoice(args.report, args.choice, { branch: args.branch, reservedAt: args.reservedAt });
      return;
    }
    if (!args.sessionId) return;
    await fetch(`${API_BASE_URL}/api/transfer/${args.sessionId}/choice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice: args.choice, branch: args.branch, reserved_at: args.reservedAt }),
    });
  } catch {
    /* 모니터링 기록 실패가 송금 흐름을 막으면 안 된다 */
  }
}
