// 룰 설정(임계치·배점)을 바꿨을 때 과거 거래가 어떻게 판정됐을지 다시 채점한다(영향 미리보기).
// backend의 account_signals / scoring / aggregator와 같은 규칙이다. 거래 로그에 남겨 둔 원측값(비율·일수·
// 건수·시각)과 2단계 구성요소(답변 점수·입력 여부·RAG 유사도)만으로 계산하므로, 같은 로그를 서버의 실제
// 엔진에 같은 설정으로 돌린 정답지(__golden__/rescore.json)와 일치해야 한다(검증: checkGolden).
import type { Level, LogSignal, RuleConfig, Scenario, TransferLog, Verdict } from "../api/types";

/** 이 위험신호가 사례집 매칭에서 직접 확인되면 점수와 무관하게 '결정적 피싱징후'(backend scoring.py와 같다). */
export const HARD_OVERRIDE_SIGNALS = new Set(["안전계좌", "원격제어앱", "화면유지요구"]);

const MATRIX: Record<Level, Record<Level, Verdict>> = {
  고: { 고: "위험", 중: "위험", 저: "주의" },
  중: { 고: "위험", 중: "주의", 저: "안전" },
  저: { 고: "위험", 중: "주의", 저: "안전" },
};

type Params = Record<string, number>;

/** 룰 하나의 점수. 원측값이 없는 룰(새로 등록한 룰, 값 미기록 로그)은 저장된 점수를 그대로 쓴다. */
export function scoreRule(rule: string, s: LogSignal, p: Params, usualHours: number[]): number {
  switch (rule) {
    case "payee_fraud":
      return s.value != null && s.value > 0 ? p.score : s.hit ? p.score : 0;
    case "fund_source":
    case "limit_change":
    case "device":
      return s.value != null && s.value > 0 ? p.score : 0;
    case "amount_anomaly": {
      if (s.value == null) return s.score;
      if (s.value >= p.ratio_high) return p.score_high;
      if (s.value >= p.ratio_mid) return p.score_mid;
      if (s.value >= p.ratio_low) return p.score_low;
      return 0;
    }
    case "payee_freshness": {
      if (s.value == null) return p.score_unknown;
      if (s.value <= p.days_new) return p.score_new;
      if (s.value <= p.days_recent) return p.score_recent;
      return 0;
    }
    case "velocity": {
      const count = s.value ?? 0;
      if (count >= p.count_high) return p.score_high;
      if (count >= p.count_mid) return p.score_mid;
      return 0;
    }
    case "time_pattern": {
      if (s.value == null) return s.score;
      if (s.value >= p.dawn_start && s.value < p.dawn_end) return p.score_dawn;
      const [start, end] = usualHours;
      if (!(s.value >= start && s.value < end)) return p.score_off_hours;
      return 0;
    }
    default:
      return s.score;
  }
}

export function accountLevelOf(total: number, g: Params): Level {
  return total >= g.account_high ? "고" : total >= g.account_mid ? "중" : "저";
}

export function contextLevelOf(total: number, hard: boolean, g: Params): Level {
  if (hard) return "고";
  return total >= g.context_high ? "고" : total >= g.context_mid ? "중" : "저";
}

export function ragScoreOf(similarity: number, g: Params): number {
  if (similarity >= g.rag_high_sim) return g.rag_high_score;
  if (similarity >= g.rag_mid_sim) return g.rag_mid_score;
  return 0;
}

export interface Rescored {
  accountTotal: number;
  accountLevel: Level;
  contextTotal: number | null;
  contextLevel: Level;
  hard: boolean;
  final: Verdict;
  signalScores: Record<string, number>;
}

export function rescoreLog(log: TransferLog, cfg: RuleConfig, corpus: Map<string, Scenario>): Rescored {
  const g = cfg.global;
  const signalScores: Record<string, number> = {};
  let total = 0;
  for (const s of log.signals) {
    const rule = cfg.rules[s.signal];
    const score = !rule ? s.score : rule.enabled ? scoreRule(s.signal, s, rule.params, log.usual_hours) : 0;
    signalScores[s.signal] = score;
    total += score;
  }
  const accountLevel = accountLevelOf(total, g);

  // 원래 받은 질문만, 그리고 새 기준에서도 받게 되는 질문만 센다(원래 받지 않은 질문은 답을 모르니 새로 받은 셈 치지 않는다).
  const askedEmpathy = log.answers_empathy != null && total >= g.intervene_question;
  const askedSafety = askedEmpathy && log.answers_safety != null && total >= g.intervene_safety;

  if (!askedEmpathy) {
    return { accountTotal: total, accountLevel, contextTotal: null, contextLevel: "저", hard: false, final: MATRIX[accountLevel]["저"], signalScores };
  }

  const inputUsed = log.input_used;
  let ragScore = 0;
  let ragHard = false;
  if (inputUsed && log.rag_similarity != null) {
    ragScore = ragScoreOf(log.rag_similarity, g);
    if (ragScore > 0 && log.rag_id) {
      const signals = corpus.get(log.rag_id)?.위험신호 ?? [];
      ragHard = signals.some((x) => HARD_OVERRIDE_SIGNALS.has(x));
    }
  }
  const contextTotal = (log.answers_empathy ?? 0) + (askedSafety ? (log.answers_safety ?? 0) : 0) + (inputUsed ? 10 : 0) + ragScore;
  const hard = (askedSafety && log.answer_hard) || ragHard;
  const contextLevel = contextLevelOf(contextTotal, hard, g);
  const final: Verdict = hard ? "위험" : MATRIX[accountLevel][contextLevel];
  return { accountTotal: total, accountLevel, contextTotal, contextLevel, hard, final, signalScores };
}
