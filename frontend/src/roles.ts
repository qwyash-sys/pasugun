// customer: 송금하는 고객 화면 / admin: 같은 흐름의 뒷단(관리자 뷰 — 판단 근거·영업점 리포트) /
// staff: 본부 담당자용 관리자 페이지(PC 화면 — 룰 관리·모니터링·통계 분석).
export type Role = "customer" | "admin" | "staff";

export const ROLE_LABEL: Record<Role, string> = { customer: "고객", admin: "관리자 뷰", staff: "관리자 페이지" };

