// SPEC 4-1 각 신호의 만점(스코어링 로직 고정값). 그래프 막대의 "꽉 찬 상태" 기준.
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

// 2단계 맥락 항목은 신호 종류가 케이스마다 달라(선택지 종류가 여러 개) 만점을 하나로
// 고정한다 — 하드오버라이드/RAG 고위험이 50점으로 가장 크므로 그걸 기준으로 삼는다.
export const CONTEXT_ITEM_MAX = 50;
