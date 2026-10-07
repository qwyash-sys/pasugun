// 거래 로그를 모아 통계를 낸다. 화면에 그리기 좋은 단순한 배열/숫자만 돌려주고 React에 의존하지 않는다.
// 정답(truth)은 로그의 합성 라벨 또는 모니터링에서 확정된 결과(makeTruthOf)로 정한다.
import type { TransferLog, Verdict } from "../api/types";
import { dayOf } from "../format";

export type Truth = "fraud" | "normal" | null;

export interface Row {
  log: TransferLog;
  truth: Truth;
  final: Verdict;
}

export const toRows = (logs: TransferLog[], truthOf: (l: TransferLog) => Truth): Row[] => logs.map((log) => ({ log, truth: truthOf(log), final: log.final }));

export interface Overview {
  total: number;
  risk: number;
  caution: number;
  safe: number;
  asked: number;
  frauds: number;
  caught: number; // 사기를 '위험'으로 잡음
  cautionOnly: number; // 사기인데 '주의'
  missed: number; // 사기인데 '안전'
  falseRisk: number;
  recall: number | null;
  precision: number | null;
  riskAmount: number;
}

export function overview(rows: Row[]): Overview {
  const o: Overview = { total: rows.length, risk: 0, caution: 0, safe: 0, asked: 0, frauds: 0, caught: 0, cautionOnly: 0, missed: 0, falseRisk: 0, recall: null, precision: null, riskAmount: 0 };
  for (const { log, truth, final } of rows) {
    if (final === "위험") {
      o.risk++;
      o.riskAmount += log.amount;
    } else if (final === "주의") o.caution++;
    else o.safe++;
    if (log.asked) o.asked++;
    if (truth === "fraud") {
      o.frauds++;
      if (final === "위험") o.caught++;
      else if (final === "주의") o.cautionOnly++;
      else o.missed++;
    } else if (truth === "normal" && final === "위험") o.falseRisk++;
  }
  o.recall = o.frauds ? o.caught / o.frauds : null;
  o.precision = o.caught + o.falseRisk ? o.caught / (o.caught + o.falseRisk) : null;
  return o;
}

export interface Group {
  key: string;
  total: number;
  risk: number;
  caution: number;
  frauds: number;
  caught: number;
  cautionOnly: number;
  missed: number;
  /** 위험 판정 비율 */
  riskRate: number;
  /** 사기 중 위험으로 잡은 비율(사기가 없으면 null) */
  recall: number | null;
}

export function groupBy(rows: Row[], keyOf: (r: Row) => string | null, order?: string[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const key = keyOf(r);
    if (key == null) continue;
    let g = map.get(key);
    if (!g) map.set(key, (g = { key, total: 0, risk: 0, caution: 0, frauds: 0, caught: 0, cautionOnly: 0, missed: 0, riskRate: 0, recall: null }));
    g.total++;
    if (r.final === "위험") g.risk++;
    else if (r.final === "주의") g.caution++;
    if (r.truth === "fraud") {
      g.frauds++;
      if (r.final === "위험") g.caught++;
      else if (r.final === "주의") g.cautionOnly++;
      else g.missed++;
    }
  }
  const out = [...map.values()];
  for (const g of out) {
    g.riskRate = g.total ? g.risk / g.total : 0;
    g.recall = g.frauds ? g.caught / g.frauds : null;
  }
  if (order) out.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  else out.sort((a, b) => b.risk - a.risk || b.total - a.total);
  return out;
}

export const AGE_ORDER = ["20대", "30대", "40대", "50대", "60대", "70대 이상"];
export const provinceOf = (region: string): string => region.split(" ")[0];

export const byAge = (rows: Row[]) => groupBy(rows, (r) => r.log.customer_age_group, AGE_ORDER);
export const byProvince = (rows: Row[]) => groupBy(rows, (r) => provinceOf(r.log.customer_region));
export const byRegion = (rows: Row[]) => groupBy(rows, (r) => r.log.customer_region);

const HOUR_BUCKETS: [string, number, number][] = [
  ["새벽 0~6시", 0, 6],
  ["오전 6~12시", 6, 12],
  ["오후 12~18시", 12, 18],
  ["저녁 18~24시", 18, 24],
];
const hourOf = (iso: string): number => (new Date(iso).getUTCHours() + 9) % 24;
export const byHour = (rows: Row[]) =>
  groupBy(rows, (r) => HOUR_BUCKETS.find(([, a, b]) => hourOf(r.log.at) >= a && hourOf(r.log.at) < b)![0], HOUR_BUCKETS.map(([k]) => k));

const AMOUNT_BUCKETS: [string, number][] = [
  ["100만원 미만", 1_000_000],
  ["100~500만원", 5_000_000],
  ["500~1,000만원", 10_000_000],
  ["1,000만원 이상", Infinity],
];
export const byAmount = (rows: Row[]) => groupBy(rows, (r) => AMOUNT_BUCKETS.find(([, max]) => r.log.amount < max)![0], AMOUNT_BUCKETS.map(([k]) => k));

/** 사기 유형별 탐지 현황 — 사기로 확정된 건만 센다. */
export const byScenario = (rows: Row[]) => groupBy(rows.filter((r) => r.truth === "fraud"), (r) => r.log.scenario ?? "분류 없음").sort((a, b) => b.frauds - a.frauds);

export interface TrendPoint {
  label: string;
  total: number;
  risk: number;
  caution: number;
  missed: number;
}

/** 주 단위 추이(월요일 시작). */
export function weeklyTrend(rows: Row[]): TrendPoint[] {
  const map = new Map<string, TrendPoint>();
  for (const r of rows) {
    const day = new Date(dayOf(r.log.at) + "T00:00:00Z");
    const dow = (day.getUTCDay() + 6) % 7;
    day.setUTCDate(day.getUTCDate() - dow);
    const key = day.toISOString().slice(5, 10);
    let p = map.get(key);
    if (!p) map.set(key, (p = { label: key.replace("-", "/"), total: 0, risk: 0, caution: 0, missed: 0 }));
    p.total++;
    if (r.final === "위험") p.risk++;
    else if (r.final === "주의") p.caution++;
    if (r.truth === "fraud" && r.final === "안전") p.missed++;
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
}

export interface RuleStat {
  signal: string;
  hitFraud: number;
  hitNormal: number;
  frauds: number;
  normals: number;
  /** 사기 거래에서 발동한 비율 / 정상 거래에서 발동한 비율 */
  fraudRate: number;
  normalRate: number;
  /** 이 룰이 발동했을 때 사기일 확률(정밀도). 발동이 없으면 null */
  precision: number | null;
}

export function ruleStats(rows: Row[], signals: string[]): RuleStat[] {
  const labeled = rows.filter((r) => r.truth);
  const frauds = labeled.filter((r) => r.truth === "fraud").length;
  const normals = labeled.length - frauds;
  return signals.map((signal) => {
    let hitFraud = 0;
    let hitNormal = 0;
    for (const r of labeled) {
      const hit = r.log.signals.find((s) => s.signal === signal)?.hit;
      if (!hit) continue;
      if (r.truth === "fraud") hitFraud++;
      else hitNormal++;
    }
    return { signal, hitFraud, hitNormal, frauds, normals, fraudRate: frauds ? hitFraud / frauds : 0, normalRate: normals ? hitNormal / normals : 0, precision: hitFraud + hitNormal ? hitFraud / (hitFraud + hitNormal) : null };
  });
}

/** 놓친 사기(안전으로 통과) / 위험으로 못 잡은 사기 — 보완 필요 시나리오의 근거. */
export const missedFrauds = (rows: Row[]): Row[] => rows.filter((r) => r.truth === "fraud" && r.final === "안전");
export const underCaught = (rows: Row[]): Row[] => rows.filter((r) => r.truth === "fraud" && r.final !== "위험");

export interface HotSegment {
  dim: "연령대" | "지역";
  key: string;
  total: number;
  frauds: number;
  /** 이 고객군의 사기 비율과, 전체 평균 대비 배수 */
  rate: number;
  lift: number;
  missed: number;
  underCaught: number;
}

/** 사기 비율이 전체 평균보다 눈에 띄게 높은 고객군(연령대·시도). 표본이 너무 작은 곳은 제외한다. */
export function hotSegments(rows: Row[], minTotal = 15, minLift = 1.25): HotSegment[] {
  const labeled = rows.filter((r) => r.truth);
  const overall = labeled.length ? labeled.filter((r) => r.truth === "fraud").length / labeled.length : 0;
  if (!overall) return [];
  const out: HotSegment[] = [];
  const scan = (dim: HotSegment["dim"], groups: Group[]) => {
    for (const g of groups) {
      const total = g.total;
      if (total < minTotal) continue;
      const rate = g.frauds / total;
      const lift = rate / overall;
      if (lift >= minLift && g.frauds >= 3) out.push({ dim, key: g.key, total, frauds: g.frauds, rate, lift, missed: g.missed, underCaught: g.missed + g.cautionOnly });
    }
  };
  scan("연령대", byAge(labeled));
  scan("지역", byProvince(labeled));
  return out.sort((a, b) => b.lift - a.lift);
}
