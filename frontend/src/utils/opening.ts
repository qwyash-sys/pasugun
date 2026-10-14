// AI 대화(M5)의 첫 마디 규칙 — backend/app/opening.py와 같다. 데모 모드와, 실제 모드에서 AI 연결이 안 될 때 쓴다.
// 앞에서 고른 답을 한 줄로 짚고 질문 하나 → AI 분석 안내로 끝낸다(누구에게 얼마 같은 세부 정보·판정은 말하지 않음).
const FOLLOW_UP: Record<string, string> = {
  safety_yes: "기관에서 '안전계좌'나 앱 설치를 안내받으셨군요. 어디서, 어떻게 연락이 왔나요?",
  risky_offer: "대출·투자 안내를 받고 보내시는군요. 돈을 먼저 보내라는 이유가 뭐였나요?",
  risky_text_only: "문자로만 연락되는 지인이시군요. 급하게 돈을 부탁받으셨나요?",
  normal_known: "가족·지인에게 보내시는군요. 직접 통화로 부탁받으셨나요?",
  normal_trade: "물건 거래 대금이시군요. 판매자와는 어디서 연락하셨나요?",
  normal_settlement: "정산 대금이시군요. 이 계좌번호는 어디서 받으셨나요?",
};
const DEFAULT_FOLLOW_UP = "어떤 일로 보내시는지 알려주세요.";
const CLOSING = "상황 설명이나 캡처를 올려주시면 AI가 분석해드릴게요.";

export function openingKey(choiceIds: string[]): string | null {
  if (choiceIds.includes("safety_yes")) return "safety_yes";
  return choiceIds.find((c) => c in FOLLOW_UP) ?? null;
}

export function ruleOpening(choiceIds: string[]): string {
  const key = openingKey(choiceIds);
  return `${(key && FOLLOW_UP[key]) || DEFAULT_FOLLOW_UP} ${CLOSING}`;
}

/** '주의' 결과에서 '그래도 송금'을 누를 때(실제로 바로 송금됨) 보여주는 요약과, 고객이 확인 표시할 문장. */
const CAUTION: Record<string, { summary: string; ack: string }> = {
  safety_yes: {
    summary: "검찰·금감원 같은 기관은 전화나 문자로 '안전계좌' 이체나 앱 설치를 요구하지 않아요. 안내받은 기관에 공식 대표번호로 직접 확인해보세요.",
    ack: "기관의 이체 요구가 정상 절차가 아닐 수 있고, 공식 번호로 직접 확인할 필요가 있다는 안내를 이해했습니다.",
  },
  risky_offer: {
    summary: "정식 금융회사는 대출·투자 전에 돈을 먼저 보내라고 하지 않아요. 안내한 기관이 등록된 곳인지, 입금 계좌가 그 기관 명의인지 먼저 확인해보세요.",
    ack: "투자·대출 안내 기관과 입금 계좌를 직접 확인할 필요가 있다는 안내를 이해했습니다.",
  },
  risky_text_only: {
    summary: "문자로만 연락되는 지인 사칭이 많아요. 송금 전에 그분께 직접 전화나 영상통화로 본인이 맞는지 확인해보세요.",
    ack: "받는 분이 본인이 맞는지 직접 통화로 확인할 필요가 있다는 안내를 이해했습니다.",
  },
};
const CAUTION_DEFAULT = {
  summary: "몇 가지 확인이 필요한 부분이 있어요. 받는 분의 신원과 계좌가 맞는지 공식 대표번호로 한 번 더 확인한 뒤 보내주세요.",
  ack: "받는 분의 신원과 계좌를 직접 확인할 필요가 있다는 안내를 이해했습니다.",
};

export function cautionCheck(choiceIds: string[]): { summary: string; ack: string } {
  const key = openingKey(choiceIds);
  return (key && CAUTION[key]) || CAUTION_DEFAULT;
}
