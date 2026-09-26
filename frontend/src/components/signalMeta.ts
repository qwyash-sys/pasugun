import type { RiskLevel } from "../types";

// SPEC 4-1 각 신호의 만점(스코어링 로직 고정값).
export const SIGNAL_META: Record<string, { label: string; max: number }> = {
  payee_fraud: { label: "수취계좌 사기이력", max: 40 },
  amount_anomaly: { label: "이체금액 이상치", max: 25 },
  fund_source: { label: "최근 자금이동(해지 등)", max: 25 },
  payee_freshness: { label: "수취계좌 개설 기간", max: 20 },
  limit_change: { label: "이체한도 변경 이력", max: 20 },
  velocity: { label: "단기간 반복 이체", max: 20 },
  device: { label: "신규 기기·환경", max: 15 },
  time_pattern: { label: "이용 시간대", max: 10 },
};

export const SIGNAL_ORDER = Object.keys(SIGNAL_META);

// 한 단계 안의 막대는 모두 같은 축(그 단계에서 가장 큰 항목의 만점)으로 그린다 —
// 항목마다 자기 만점을 100%로 잡으면 40점 만점에 40점과 25점 만점에 25점이 똑같이 꽉 찬다.
export const STAGE1_SCALE = Math.max(...Object.values(SIGNAL_META).map((m) => m.max));

// 2단계 항목 만점(backend app/questions.py 선택지 가중치, app/scoring.py 입력가점·RAG 점수).
export const CONTEXT_MAX = { empathy: 25, safety: 50, input: 10, rag: 50 } as const;
export const STAGE2_SCALE = 50;

// backend app/questions.py 선택지 문구.
export const CHOICE_LABELS: Record<string, string> = {
  normal_known: "직접 아는 지인·가족에게 보내요",
  normal_trade: "물건 구매/판매 대금이에요",
  normal_settlement: "임대료·잔금 등 정산 목적이에요",
  risky_offer: "최근 대출·투자 안내를 받고 보내요",
  risky_text_only: "아는 사람이라는데 문자로만 연락돼요",
  safety_no: "아니요",
  safety_yes: "비슷한 안내를 받았어요",
};

// backend app/scoring.py account_level / context_level 경계값.
export interface LevelBand {
  level: RiskLevel;
  from: number;
  /** 포함 상한. 마지막 구간은 null(상한 없음). */
  to: number | null;
}

export const ACCOUNT_BANDS: LevelBand[] = [
  { level: "저", from: 0, to: 29 },
  { level: "중", from: 30, to: 59 },
  { level: "고", from: 60, to: null },
];

export const CONTEXT_BANDS: LevelBand[] = [
  { level: "저", from: 0, to: 24 },
  { level: "중", from: 25, to: 49 },
  { level: "고", from: 50, to: null },
];

export function bandLabel(b: LevelBand): string {
  return b.to === null ? `${b.from}점 이상` : `${b.from}~${b.to}점`;
}

// backend app/scoring.py HARD_OVERRIDE_RISK_SIGNALS.
export const HARD_OVERRIDE_RISK_SIGNALS = ["안전계좌", "원격제어앱", "화면유지요구"];

// 사례집 유형(backend mock_data/scenarios.json "유형").
export const RAG_TYPES = ["기관사칭", "대출사기", "메신저피싱", "협박형", "스미싱", "몸캠피싱", "취업사기", "원격제어형"];
