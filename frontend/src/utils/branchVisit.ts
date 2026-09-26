// 영업점 상담 예약(프로토타입): 지금이 영업시간이면 오늘 가장 빠른 시간, 아니면 다음 영업일
// 첫 시간으로 가까운 영업점 방문을 잡아준다. 실제 예약 API 없이 화면 흐름만 재현한다.
// 기기 시간대와 무관하게 항상 한국 시각(KST) 기준으로 계산한다.

/** 2026년 은행 휴무일(공휴일·대체공휴일·근로자의날). 주말은 따로 판단한다. */
const BANK_HOLIDAYS_2026 = new Set([
  "2026-01-01",
  "2026-02-16", "2026-02-17", "2026-02-18", // 설날 연휴
  "2026-03-02", // 삼일절 대체
  "2026-05-01", // 근로자의날(은행 휴무)
  "2026-05-05",
  "2026-05-25", // 부처님오신날 대체
  "2026-06-03", // 전국동시지방선거
  "2026-08-17", // 광복절 대체
  "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-28", // 추석 연휴 + 대체
  "2026-10-05", // 개천절 대체
  "2026-10-09",
  "2026-12-25",
]);

export const BRANCH_OPEN = 9 * 60; // 09:00
export const BRANCH_CLOSE = 16 * 60; // 16:00
const LAST_SLOT = 15 * 60 + 30; // 마감 30분 전까지만 상담 예약을 받는다
const LEAD_MINUTES = 20; // 지금 바로는 못 가니 최소 20분 뒤부터(30분 단위 시간표로 올림)

export const NEAREST_BRANCH = { name: "양재남지점", distance: "0.6km", area: "서울 서초구" };
export const VISIT_PURPOSE = "AI파수꾼 송금분석 상담 내방";

/** KST 기준 달력 날짜 + 자정부터의 분. */
interface KstMoment {
  y: number;
  m: number; // 1~12
  d: number;
  weekday: number; // 0=일
  minutes: number;
}

function toKst(now: Date): KstMoment {
  const k = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return {
    y: k.getUTCFullYear(),
    m: k.getUTCMonth() + 1,
    d: k.getUTCDate(),
    weekday: k.getUTCDay(),
    minutes: k.getUTCHours() * 60 + k.getUTCMinutes(),
  };
}

function isoDay(t: KstMoment): string {
  return `${t.y}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
}

function isBusinessDay(t: KstMoment): boolean {
  return t.weekday !== 0 && t.weekday !== 6 && !BANK_HOLIDAYS_2026.has(isoDay(t));
}

function addDays(t: KstMoment, days: number): KstMoment {
  const utc = new Date(Date.UTC(t.y, t.m - 1, t.d + days));
  return { y: utc.getUTCFullYear(), m: utc.getUTCMonth() + 1, d: utc.getUTCDate(), weekday: utc.getUTCDay(), minutes: 0 };
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export interface VisitPlan {
  /** today: 영업시간 중이라 오늘 예약 / beforeOpen: 오늘 영업일인데 개점 전 → 오늘 첫 시간 /
   * closed: 영업시간 종료(또는 휴무일) → 다음 영업일 첫 시간. */
  kind: "today" | "beforeOpen" | "closed";
  /** closed일 때 다음 영업일이 바로 내일인지 — 안내 문구의 "익일" / "다음 영업일" 구분용. */
  nextDayIsTomorrow: boolean;
  /** closed의 이유 — 휴무일(주말·공휴일) / 영업시간 종료 / 영업 중이지만 오늘 남은 상담 시간이 없음. */
  closedReason: "holiday" | "afterHours" | "tooLate" | null;
  dateLabel: string; // "9월 28일(월)"
  time: string; // "15:00"
}

function label(t: KstMoment): string {
  return `${t.m}월 ${t.d}일(${WEEKDAYS[t.weekday]})`;
}

export function planBranchVisit(now: Date = new Date()): VisitPlan {
  const t = toKst(now);
  if (isBusinessDay(t) && t.minutes < BRANCH_OPEN) {
    return { kind: "beforeOpen", nextDayIsTomorrow: false, closedReason: null, dateLabel: label(t), time: hhmm(BRANCH_OPEN) };
  }
  if (isBusinessDay(t) && t.minutes < BRANCH_CLOSE) {
    // 20분 뒤를 30분 단위로 올림(13:10 → 13:30, 13:40 → 14:00, 15:05 → 15:30).
    const slot = Math.ceil((t.minutes + LEAD_MINUTES) / 30) * 30;
    if (slot <= LAST_SLOT) return { kind: "today", nextDayIsTomorrow: false, closedReason: null, dateLabel: label(t), time: hhmm(slot) };
  }
  let day = addDays(t, 1);
  while (!isBusinessDay(day)) day = addDays(day, 1);
  return {
    kind: "closed",
    nextDayIsTomorrow: isoDay(day) === isoDay(addDays(t, 1)),
    closedReason: !isBusinessDay(t) ? "holiday" : t.minutes < BRANCH_CLOSE ? "tooLate" : "afterHours",
    dateLabel: label(day),
    time: hhmm(BRANCH_OPEN),
  };
}

/** 예약 안내 문구(사용자 요청 표현 그대로). */
export function visitGuide(plan: VisitPlan): string {
  if (plan.kind === "today") return "현재 가까운 거리 영업점을 안내 및 예약해드릴게요.";
  if (plan.kind === "beforeOpen") return "아직 영업 시작 전이라, 가까운 거리 영업점을 안내 및 오늘 제일 빠른 시간으로 예약해드릴게요.";
  const when = plan.nextDayIsTomorrow ? "익일" : "다음 영업일";
  if (plan.closedReason === "tooLate")
    return `오늘 상담 가능한 시간이 지나 가까운 거리 영업점을 안내 및 ${when} 제일 빠른 시간으로 예약해드릴게요.`;
  if (plan.closedReason === "holiday") return `오늘은 영업점 휴무일이라 가까운 거리 영업점을 안내 및 ${when} 제일 빠른 시간으로 예약해드릴게요.`;
  return `영업시간이 모두 종료되어 가까운 거리 영업점을 안내 및 ${when} 제일 빠른 시간으로 예약해드릴게요.`;
}
