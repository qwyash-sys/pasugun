import type { CaseDoc } from "../../api/types";
import type { Tone } from "../../components/ui";

/** 화면에 보여주는 진행 상태 이름(저장 값은 그대로 두고 표시만 본부 업무 용어로 바꾼다). */
const STATUS_LABEL: Record<string, string> = {
  "본부 검토 대기": "본부 승인 대기",
  "재확인 완료": "본부 승인 대기(재확인)",
  "면담 결과 확인 대기": "본부 확인 대기(면담)",
  "사후확인 대기": "본부 재분석 대기(송금)",
  "사후확인 결과 확인 대기": "본부 확인 대기(재분석)",
};

export const statusLabel = (status: string): string => STATUS_LABEL[status] ?? status;

/** 색: 본부가 처리할 차례(빨강) · 영업점 면담(파랑) · 지연송금 진행(노랑) · 송금 재분석(초록) · 대기/종결(회색). */
export const STATUS_TONE: Record<string, Tone> = {
  "고객 선택 대기": "muted",
  "면담 대기": "blue",
  "면담 결과 확인 대기": "danger",
  "본부 검토 대기": "danger",
  "고객 재확인 중": "warn",
  "재확인 완료": "danger",
  "사후확인 대기": "green",
  "사후확인 결과 확인 대기": "green",
  종결: "muted",
};

export const statusTone = (c: CaseDoc): Tone => STATUS_TONE[c.status] ?? "default";

export const CHOICE_TONE: Record<CaseDoc["choice"], Tone> = { visit: "blue", delayed: "warn", abandoned: "muted", pending: "muted" };

/** 상태별로 '누가 다음 차례인지' 한 줄 안내. */
export const WAITING_ON: Record<string, string> = {
  "고객 선택 대기": "고객 선택 대기 중",
  "면담 대기": "영업점 책임자 면담 대기",
  "면담 결과 확인 대기": "본부 확인 필요",
  "본부 검토 대기": "본부 승인 판단 필요",
  "고객 재확인 중": "고객 의사 재확인 중",
  "재확인 완료": "본부 승인 판단 필요",
  "사후확인 대기": "본부 재분석 필요",
  "사후확인 결과 확인 대기": "본부 확인 필요",
  종결: "처리 완료",
};

export const ACTIVITY_ICON: Record<string, string> = { in: "⬇️", split: "🔀", atm: "🏧", overseas: "🪙", report: "🚨", normal_use: "✅", hold: "⏸️" };
