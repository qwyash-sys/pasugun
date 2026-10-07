// 관리자 페이지 공통 표시 형식. 시각은 보는 기기의 시간대와 상관없이 항상 한국 시간(KST)으로 보여준다.
const KST_OFFSET_MS = 9 * 3600_000;

/** Date → "2026-10-07T15:04:05+09:00" (서버가 저장하는 형식과 같다). */
export function kstIso(d: Date): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 19) + "+09:00";
}

const parts = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + KST_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return { y: d.getUTCFullYear(), mo: p(d.getUTCMonth() + 1), d: p(d.getUTCDate()), h: p(d.getUTCHours()), mi: p(d.getUTCMinutes()), dow: d.getUTCDay() };
};

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/** "10-07 15:04" */
export function fmtShort(iso: string): string {
  const t = parts(iso);
  return `${t.mo}-${t.d} ${t.h}:${t.mi}`;
}

/** "2026-10-07 15:04" */
export function fmtDateTime(iso: string): string {
  const t = parts(iso);
  return `${t.y}-${t.mo}-${t.d} ${t.h}:${t.mi}`;
}

/** "10월 7일(화) 15:04" */
export function fmtKorean(iso: string): string {
  const t = parts(iso);
  return `${Number(t.mo)}월 ${Number(t.d)}일(${DOW[t.dow]}) ${t.h}:${t.mi}`;
}

/** "2026-10-07" */
export const dayOf = (iso: string): string => fmtDateTime(iso).slice(0, 10);

export const won = (n: number): string => `${n.toLocaleString()}원`;

/** 큰 금액은 "1,200만원"처럼 줄여서(표 안에서 폭을 아끼려고). */
export function wonShort(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(n % 100_000_000 ? 1 : 0)}억원`;
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString()}만원`;
  return won(n);
}

export const pct = (v: number | null, digits = 0): string => (v == null ? "-" : `${(v * 100).toFixed(digits)}%`);
