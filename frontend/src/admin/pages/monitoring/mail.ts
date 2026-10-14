// 본부가 영업점 담당 준법감시책임자에게 보내는 개인우편(면담 요청) 본문. 본부 상세 패널과 책임자 화면이 같은 내용을 본다.
import type { CaseDoc, ReportPayload } from "../../api/types";
import { fmtKorean, won } from "../../format";

export function mailBody(doc: CaseDoc, report: ReportPayload): string {
  const v = doc.visit!;
  return [
    `${v.officer.name} ${v.officer.title}님께,`,
    "",
    `AI파수꾼이 아래 거래를 고위험으로 분류했고, 고객이 영업점 내방을 예약했습니다. 면담 후 결과를 입력해 주세요.`,
    "",
    `· 고객: ${report.customer_name} (${report.customer_phone_masked})`,
    `· 예약: ${v.branch} ${fmtKorean(v.reserved_at)}`,
    `· 거래: ${report.payee_bank} ${report.payee_name} ${won(report.amount)}`,
    `· 판정: ${report.final.final}(송금위험도 ${report.final.account_level} · AI분석 ${report.final.context_level})`,
    `· 권고: ${report.recommendation}`,
    "",
    "※ 본 메일은 개인우편으로 담당 책임자에게만 전달됩니다.",
  ].join("\n");
}
