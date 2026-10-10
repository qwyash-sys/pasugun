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

/** 1단계 송금위험도 룰 11개(업무 룰 목록). signal이 있으면 현재 구현·적용 중, 없으면 아직 점수에
 * 반영하지 않는 준비 중 룰이다. 정의·조건은 업무 문구 그대로, scoring은 이 시스템의 실제 배점이다.
 * 백엔드가 같은 설명을 내려주면(신규 룰 포함) 그쪽을 우선하고, 이 표는 데모·예전 리포트용 보충이다. */
export interface RuleInfo {
  id: string;
  name: string;
  definition: string;
  condition: string;
  scoring?: string;
  signal?: string;
}

export const RULE_CATALOG: RuleInfo[] = [
  { id: "R01", signal: "payee_fraud", name: "수취계좌 사기이력", definition: "수취계좌의 사기신고 이력 여부", condition: "신고 건수에 따라 점수 배점", scoring: "사기신고 1건 이상 40점 · 3건 이상 40점(다건 배점, 조정 가능) · 없음 0점 — 기본값은 건수와 무관하게 같은 점수" },
  { id: "R02", signal: "amount_anomaly", name: "이체금액 이상치", definition: "평소 이체금액 대비 이번 이체금액의 이상 정도", condition: "평소 대비 배수 구간에 따라 점수 배점", scoring: "평소의 10배 이상 25점 · 5배 이상 15점 · 2배 이상 8점 · 그 미만 0점" },
  { id: "R03", signal: "fund_source", name: "최근 자금이동", definition: "예·적금 해지 등 자금원천 이동 여부", condition: "자금원천 이동 후 경과시간에 따라 점수 배점", scoring: "24시간 이내 자금 이동 25점 · 없음 0점" },
  { id: "R04", signal: "payee_freshness", name: "수취계좌 개설경과", definition: "수취계좌 개설 후 경과일수", condition: "개설 경과일 구간에 따라 점수 배점", scoring: "개설 7일 이내 20점 · 30일 이내 10점 · 그 이후 0점 (개설일 확인 불가는 신규로 보고 20점)" },
  { id: "R05", signal: "limit_change", name: "이체한도 변경이력", definition: "최근 이체한도 상향 이력", condition: "최근 한도상향 이력 유무에 따라 점수 배점", scoring: "24시간 이내 한도 상향 20점 · 없음 0점" },
  { id: "R06", signal: "velocity", name: "단시간 반복이체", definition: "짧은 시간 내 다건 이체 또는 분할 재시도 (단시간 다건이체 + 분할이체 통합)", condition: "단시간 내 이체(분할 포함) 건수에 따라 점수 배점", scoring: "10분 내 3건 이상 20점 · 2건 10점 · 그 미만 0점 (분할 재시도는 건수에 포함)" },
  { id: "R07", signal: "device", name: "접속환경 변경", definition: "기기·접속위치 등 접속환경 변화 (신규기기 + 로그인위치 급변 통합)", condition: "기기·위치 변경 이력 유무에 따라 점수 배점", scoring: "신규 기기·환경 감지 15점 · 없음 0점" },
  { id: "R08", signal: "time_pattern", name: "거래시간대 이상", definition: "평소와 다른 시간대 거래", condition: "평소 거래시간대 이탈 여부에 따라 점수 배점", scoring: "새벽 00~06시 10점 · 평소 이용시간 밖 5점 · 평소 시간대 0점" },
  { id: "R09", name: "잔액소진율", definition: "이체 후 잔액이 거의 소진되는지", condition: "이체 후 잔액 소진 정도(구간)에 따라 점수 배점" },
  { id: "R10", name: "신규 수취인 비율", definition: "평소 이체 상대 외 새 수취인 비중 급증", condition: "신규 수취인 비중 구간에 따라 점수 배점" },
  { id: "R11", name: "다수입금 집중", definition: "수취계좌가 단기간 다수로부터 소액 입금받은 이력", condition: "단기간 입금인원 수에 따라 점수 배점" },
];

/** 신호(signal) 하나의 룰 설명. 백엔드가 준 값이 있으면 그걸, 없으면 목록에서 찾고, 둘 다 없으면 null. */
export function ruleOf(s: {
  signal: string;
  label?: string;
  rule_id?: string;
  definition?: string;
  condition?: string;
  scoring?: string;
}): Omit<RuleInfo, "signal"> | null {
  const fromCatalog = RULE_CATALOG.find((r) => r.signal === s.signal);
  const id = s.rule_id || fromCatalog?.id;
  const definition = s.definition || fromCatalog?.definition;
  const condition = s.condition || fromCatalog?.condition;
  if (!id || !definition || !condition) return null;
  return {
    id,
    name: s.label || fromCatalog?.name || s.signal,
    definition,
    condition,
    scoring: s.scoring || fromCatalog?.scoring,
  };
}
