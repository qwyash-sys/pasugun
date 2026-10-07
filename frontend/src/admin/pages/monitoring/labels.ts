import type { CaseDoc } from "../../api/types";
import type { Tone } from "../../components/ui";

export const STATUS_TONE: Record<string, Tone> = {
  "고객 선택 대기": "muted",
  "면담 대기": "blue",
  "면담 결과 확인 대기": "warn",
  "본부 검토 대기": "danger",
  "고객 재확인 중": "blue",
  "재확인 완료": "warn",
  "사후확인 대기": "purple",
  "사후확인 결과 확인 대기": "warn",
  종결: "green",
};

export const statusTone = (c: CaseDoc): Tone => STATUS_TONE[c.status] ?? "default";

export const CHOICE_TONE: Record<CaseDoc["choice"], Tone> = { visit: "blue", delayed: "warn", abandoned: "muted", pending: "muted" };

/** 상태별로 '누가 다음 차례인지' 한 줄 안내. */
export const WAITING_ON: Record<string, string> = {
  "고객 선택 대기": "고객 선택 대기 중",
  "면담 대기": "영업점 책임자 면담 대기",
  "면담 결과 확인 대기": "본부 확인 필요",
  "본부 검토 대기": "본부 판단 필요",
  "고객 재확인 중": "고객 의사 재확인 중",
  "재확인 완료": "본부 판단 필요",
  "사후확인 대기": "본부 사후 확인 필요",
  "사후확인 결과 확인 대기": "본부 확인 필요",
  종결: "처리 완료",
};

export const ACTIVITY_ICON: Record<string, string> = { in: "⬇️", split: "🔀", atm: "🏧", overseas: "🪙", report: "🚨", normal_use: "✅", hold: "⏸️" };
