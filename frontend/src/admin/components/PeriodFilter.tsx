// 기간 조건(모니터링·통계 공통). 기준은 '지금'(한국 시간)이고, 직접 지정하면 시작·끝 날짜를 고른다.
import { dayOf, kstIso } from "../format";

export type PeriodPreset = "today" | "3" | "7" | "30" | "90" | "all" | "custom";

export interface Period {
  preset: PeriodPreset;
  /** 직접 지정일 때만 쓰는 KST 날짜(YYYY-MM-DD) */
  from: string;
  to: string;
}

const LABEL: Record<PeriodPreset, string> = {
  today: "오늘",
  "3": "최근 3일",
  "7": "최근 7일",
  "30": "최근 30일",
  "90": "최근 90일",
  all: "전체 기간",
  custom: "직접 지정",
};

export const periodOf = (preset: PeriodPreset): Period => ({ preset, from: "", to: "" });

/** 기간의 KST 날짜 범위 [from, to] (포함). 전체면 null. */
export function periodRange(p: Period, now: Date = new Date()): { from: string; to: string } | null {
  const today = dayOf(kstIso(now));
  if (p.preset === "all") return null;
  if (p.preset === "custom") return { from: p.from || "0000-00-00", to: p.to || "9999-12-31" };
  const days = p.preset === "today" ? 0 : Number(p.preset) - 1;
  return { from: dayOf(kstIso(new Date(now.getTime() - days * 86400_000))), to: today };
}

export function inPeriod(iso: string, p: Period, now: Date = new Date()): boolean {
  const r = periodRange(p, now);
  if (!r) return true;
  const d = dayOf(iso);
  return d >= r.from && d <= r.to;
}

export function periodText(p: Period, now: Date = new Date()): string {
  const r = periodRange(p, now);
  if (!r) return "전체 기간";
  if (p.preset === "custom") return `${p.from || "처음"} ~ ${p.to || "오늘"}`;
  return r.from === r.to ? `${r.from} (오늘)` : `${r.from} ~ ${r.to}`;
}

export default function PeriodFilter({ value, onChange, presets = ["today", "3", "7", "30", "all", "custom"] }: { value: Period; onChange: (p: Period) => void; presets?: PeriodPreset[] }) {
  const today = dayOf(kstIso(new Date()));
  return (
    <div className="c-period">
      <select
        aria-label="기간"
        value={value.preset}
        onChange={(e) => {
          const preset = e.target.value as PeriodPreset;
          if (preset !== "custom") return onChange(periodOf(preset));
          const r = periodRange(value) ?? { from: "", to: today };
          onChange({ preset, from: r.from === "0000-00-00" ? "" : r.from, to: r.to === "9999-12-31" ? today : r.to });
        }}
      >
        {presets.map((p) => (
          <option key={p} value={p}>
            {LABEL[p]}
          </option>
        ))}
      </select>
      {value.preset === "custom" && (
        <>
          <input type="date" aria-label="시작 날짜" value={value.from} max={value.to || today} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          <span className="c-muted">~</span>
          <input type="date" aria-label="끝 날짜" value={value.to} min={value.from || undefined} max={today} onChange={(e) => onChange({ ...value, to: e.target.value })} />
        </>
      )}
    </div>
  );
}
