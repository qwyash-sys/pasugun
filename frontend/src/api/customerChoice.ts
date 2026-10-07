// 위험 결과 화면에서 고객이 고른 분기(영업점 내방 예약 / 지연송금 / 송금 중단)를 본부 모니터링에 알린다.
// 실제 모드는 백엔드가 사례를 갱신하고, 데모 모드는 이 브라우저의 관리자 페이지 데이터에 새 사례로 남는다.
// 알리는 데 실패해도 고객 흐름은 절대 막지 않는다(조용히 무시).
import { API_BASE_URL, RESPONSE_SOURCE } from "../config";
import type { ReportPayload } from "../types";

export type CustomerChoice = "visit" | "delayed" | "abandoned";

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
      const { recordDemoChoice } = await import("../admin/api/demoApi");
      await recordDemoChoice(args.report, args.choice, { branch: args.branch, reservedAt: args.reservedAt });
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
