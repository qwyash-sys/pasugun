// 관리자 페이지 공통 화면 부품. 차트는 라이브러리 없이 CSS·SVG로 그린다(번들을 가볍게).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

// ---------------------------------------------------------------- 데이터 불러오기
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async (silent = false) => {
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fnRef.current();
      setState({ data, error: null, loading: false });
    } catch (e) {
      setState((s) => ({ data: silent ? s.data : null, error: e instanceof Error ? e.message : "불러오지 못했어요.", loading: false }));
    }
  }, []);
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { ...state, reload };
}

export function Loading({ text = "불러오는 중…" }: { text?: string }) {
  return (
    <div className="c-loading" role="status">
      <span className="c-spinner" aria-hidden />
      {text}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="c-error" role="alert">
      <strong>데이터를 불러오지 못했어요</strong>
      <span>{message}</span>
      {onRetry && (
        <button className="c-btn c-btn-sm" onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 기본 부품
export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="c-header">
      <div>
        <h1 className="c-title">{title}</h1>
        {sub && <p className="c-sub">{sub}</p>}
      </div>
      {actions && <div className="c-header-actions">{actions}</div>}
    </header>
  );
}

export function Card({ title, sub, actions, children, className = "" }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`c-card ${className}`}>
      {(title || actions) && (
        <div className="c-card-head">
          <div>
            {title && <h2 className="c-card-title">{title}</h2>}
            {sub && <p className="c-card-sub">{sub}</p>}
          </div>
          {actions && <div className="c-card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export type Tone = "default" | "green" | "danger" | "warn" | "blue" | "purple" | "muted";

export function Badge({ tone = "default", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`c-badge tone-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Kpi({ label, value, sub, tone = "default", onClick, active }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; onClick?: () => void; active?: boolean }) {
  const body = (
    <>
      <span className="c-kpi-label">{label}</span>
      <strong className="c-kpi-value">{value}</strong>
      {sub && <span className="c-kpi-sub">{sub}</span>}
    </>
  );
  return onClick ? (
    <button className={`c-kpi tone-${tone} clickable ${active ? "active" : ""}`} onClick={onClick} aria-pressed={active}>
      {body}
    </button>
  ) : (
    <div className={`c-kpi tone-${tone}`}>{body}</div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string; count?: number }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="c-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} className={o.id === value ? "on" : ""} aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
          {o.label}
          {o.count != null && <span className="c-seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="c-empty">{children}</div>;
}

// ---------------------------------------------------------------- 차트
export interface BarSegment {
  value: number;
  tone: Tone;
  label: string;
}
export interface BarRow {
  label: string;
  sub?: string;
  segments: BarSegment[];
  /** 오른쪽에 붙는 값 문구 */
  trailing?: string;
}

/** 가로 막대(분절 가능). max를 주면 모든 행이 같은 눈금을 쓴다. */
export function BarRows({ rows, max }: { rows: BarRow[]; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.segments.reduce((s, x) => s + x.value, 0)));
  return (
    <ul className="c-bars">
      {rows.map((r) => {
        const total = r.segments.reduce((s, x) => s + x.value, 0);
        return (
          <li key={r.label}>
            <span className="c-bar-label">
              {r.label}
              {r.sub && <small>{r.sub}</small>}
            </span>
            <span className="c-bar-track" role="img" aria-label={`${r.label}: ${r.segments.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
              {r.segments.map((s, i) => (
                <span key={i} className={`c-bar-seg tone-${s.tone}`} style={{ width: `${(s.value / top) * 100}%` }} title={`${s.label} ${s.value}`} />
              ))}
            </span>
            <span className="c-bar-val">{r.trailing ?? total}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function Legend({ items }: { items: { label: string; tone: Tone }[] }) {
  return (
    <div className="c-legend">
      {items.map((i) => (
        <span key={i.label}>
          <i className={`c-dot tone-${i.tone}`} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export interface TrendPoint {
  label: string;
  bars: number;
  line: number;
  extra?: number;
}

/** 막대(전체 건수) + 꺾은선(위험 건수) 겹친 추이 차트. */
export function TrendChart({ points, barLabel, lineLabel }: { points: TrendPoint[]; barLabel: string; lineLabel: string }) {
  const W = 640;
  const H = 200;
  const pad = { l: 34, r: 12, t: 12, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const maxBar = Math.max(1, ...points.map((p) => p.bars));
  const slot = iw / Math.max(1, points.length);
  const bw = Math.min(34, slot * 0.6);
  const x = (i: number) => pad.l + slot * i + slot / 2;
  const y = (v: number) => pad.t + ih - (v / maxBar) * ih;
  const ticks = [0, 0.5, 1].map((t) => Math.round(maxBar * t));
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.line).toFixed(1)}`).join(" ");
  return (
    <svg className="c-trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${barLabel}와 ${lineLabel}의 주간 추이`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="c-grid" />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="c-axis">
            {t}
          </text>
        </g>
      ))}
      {points.map((p, i) => (
        <g key={p.label}>
          <rect x={x(i) - bw / 2} y={y(p.bars)} width={bw} height={Math.max(0, pad.t + ih - y(p.bars))} rx={4} className="c-trend-bar">
            <title>{`${p.label} ${barLabel} ${p.bars}건 · ${lineLabel} ${p.line}건`}</title>
          </rect>
          <text x={x(i)} y={H - 8} textAnchor="middle" className="c-axis">
            {p.label}
          </text>
        </g>
      ))}
      <path d={line} className="c-trend-line" fill="none" />
      {points.map((p, i) => (
        <circle key={p.label} cx={x(i)} cy={y(p.line)} r={3.5} className="c-trend-dot" />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------- 오른쪽 패널·알림
export function Drawer({ open, title, sub, onClose, children, footer, wide }: { open: boolean; title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="c-drawer-root">
      <div className="c-scrim" onClick={onClose} />
      <aside className={`c-drawer ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : "상세"} ref={ref} tabIndex={-1}>
        <header className="c-drawer-head">
          <div>
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          <button className="c-btn c-btn-sm c-btn-ghost" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </header>
        <div className="c-drawer-body">{children}</div>
        {footer && <footer className="c-drawer-foot">{footer}</footer>}
      </aside>
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="c-modal-root">
      <div className="c-scrim" onClick={onClose} />
      <div className="c-modal" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : "입력"}>
        <h2>{title}</h2>
        <div className="c-modal-body">{children}</div>
        {footer && <div className="c-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState<{ text: string; tone: Tone; id: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string, tone: Tone = "green") => {
    window.clearTimeout(timer.current);
    setToast({ text, tone, id: Date.now() });
    timer.current = window.setTimeout(() => setToast(null), 3800);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const node = toast ? (
    <div key={toast.id} className={`c-toast tone-${toast.tone}`} role="status" aria-live="polite">
      {toast.text}
    </div>
  ) : null;
  return { show, node };
}

/** 입력칸 + 라벨 + 오류 문구. */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className={`c-field ${error ? "has-error" : ""}`}>
      <span className="c-field-label">{label}</span>
      {children}
      {error ? <span className="c-field-error">{error}</span> : hint ? <span className="c-field-hint">{hint}</span> : null}
    </label>
  );
}
