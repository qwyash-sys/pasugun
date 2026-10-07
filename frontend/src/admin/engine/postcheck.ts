// 사후 확인(송금 실행 뒤 수취계좌 거래내역 재분석). 서버(backend/app/payee_activity.py)와 같은 판정 규칙이고,
// 서버가 없는 데모모드에서 쓴다. 판정은 거래내역 신호를 세는 규칙이 정하고, AI는 설명문만 쓴다(데모는 규칙 문장).
import type { ActivityEvent, Analysis } from "../api/types";
import { kstIso } from "../format";

/** 문자열 → 재현 가능한 난수 생성기(같은 사례는 늘 같은 거래내역이 나오게). */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rng: () => number, items: T[]): T => items[Math.floor(rng() * items.length)];
const between = (rng: () => number, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));

function at(base: Date, minutes: number): string {
  return kstIso(new Date(base.getTime() + minutes * 60_000));
}

export function makeActivity(sentAt: string, amount: number, suspicious: boolean, rng: () => number): ActivityEvent[] {
  const base = new Date(sentAt);
  const events: ActivityEvent[] = [{ at: at(base, 0), kind: "in", text: `${amount.toLocaleString()}원 입금(분석 대상 거래)`, amount }];
  if (suspicious) {
    const parts = pick(rng, [2, 3, 4]);
    events.push({ at: at(base, between(rng, 4, 15)), kind: "split", text: `입금 직후 ${parts}개 계좌로 분산 이체(건당 약 ${Math.floor(amount / parts).toLocaleString()}원)`, amount });
    if (rng() < 0.75) {
      const cash = Math.floor(amount / pick(rng, [3, 4, 5]));
      events.push({ at: at(base, between(rng, 20, 55)), kind: "atm", text: `ATM 현금 출금 ${cash.toLocaleString()}원`, amount: cash });
    }
    if (rng() < 0.45) events.push({ at: at(base, between(rng, 70, 180)), kind: "overseas", text: "가상자산 거래소 연동 계좌로 이체", amount: Math.floor(amount / 2) });
    if (rng() < 0.6) events.push({ at: at(base, 240), kind: "report", text: `동일 수취계좌에 대한 다른 피해 신고 ${pick(rng, [1, 2, 3])}건 접수` });
  } else {
    events.push({ at: at(base, between(rng, 600, 1500)), kind: "normal_use", text: pick(rng, ["다음 영업일 공과금·관리비 자동이체 정상 출금", "카드 대금 결제 출금(평소 사용 패턴)", "급여·정기 입금 이력과 같은 패턴"]) });
    events.push({ at: at(base, 2880), kind: "hold", text: "이후 48시간 추가 자금 이동 없음(보유)" });
  }
  return events;
}

export function analyzeActivity(activity: ActivityEvent[], at: string): Analysis {
  const count = (k: ActivityEvent["kind"]) => activity.filter((e) => e.kind === k).length;
  const risk = 40 * count("split") + 25 * count("atm") + 20 * count("overseas") + 30 * count("report");
  const calm = 30 * count("normal_use") + 15 * count("hold");
  const score = Math.max(0, risk - calm);
  let evidence = activity.filter((e) => ["split", "atm", "overseas", "report"].includes(e.kind)).map((e) => e.text);
  if (!evidence.length) evidence = activity.filter((e) => ["normal_use", "hold"].includes(e.kind)).map((e) => e.text);
  if (!evidence.length) evidence = ["입금 외 특이한 자금 이동이 확인되지 않았어요."];

  if (score >= 60) {
    return { at, verdict: "사기 의심", confidence: Math.min(97, 62 + Math.floor(score / 2)), evidence, source: "rule", action: "수취은행에 지급정지를 요청하고 피해 구제 절차(피해 신고·환급 안내)를 고객에게 안내하세요.", narrative: "입금 직후 자금이 짧은 시간 안에 여러 곳으로 흩어지거나 현금화되는 전형적인 사기 자금 이동 패턴이에요." };
  }
  if (score >= 25) {
    return { at, verdict: "추가 확인 필요", confidence: 55 + Math.floor(score / 3), evidence, source: "rule", action: "고객에게 거래 경위를 재확인하고, 수취계좌의 이후 움직임을 24시간 더 모니터링하세요.", narrative: "의심스러운 신호가 일부 있지만 사기로 단정하기엔 근거가 부족해요. 경위 확인이 필요해요." };
  }
  return { at, verdict: "정상 가능성 높음", confidence: Math.min(95, 70 + Math.floor((calm - risk) / 3)), evidence, source: "rule", action: "특이 사항이 없어 정상 거래로 종결 처리해도 돼요.", narrative: "입금 이후 자금 흐름이 일상적인 사용 패턴과 같고 이상 신호가 확인되지 않았어요." };
}
