import { Fragment, useState } from "react";
import { CONTEXT_ITEM_MAX, SIGNAL_META, SIGNAL_ORDER } from "./signalMeta";
import type { AccountAssessment, ContextAssessment, Question, RiskLevel } from "../types";

interface Props {
  account: AccountAssessment;
  context: ContextAssessment | null;
  questions: Question[];
}

function BarRow({
  label,
  score,
  max,
  hit,
  tooltip,
}: {
  label: string;
  score: number;
  max: number;
  hit: boolean;
  tooltip: string;
}) {
  const [open, setOpen] = useState(false);
  const pct = Math.max(2, Math.min(100, (score / max) * 100));

  return (
    <div
      className="bar-row"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((o) => !o)}
    >
      <span className="bar-row-label">{label}</span>
      <div className="bar-row-track">
        <div className={`bar-row-fill ${hit ? "hit" : ""}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`bar-row-score ${hit ? "hit" : ""}`}>+{score}</span>
      {open && <div className="bar-row-tooltip">{tooltip}</div>}
    </div>
  );
}

const MATRIX_ORDER: RiskLevel[] = ["고", "중", "저"];
const MATRIX_RESULT: Record<RiskLevel, Record<RiskLevel, string>> = {
  고: { 고: "🔴", 중: "🔴", 저: "🟡" },
  중: { 고: "🔴", 중: "🟡", 저: "🟢" },
  저: { 고: "🔴", 중: "🟡", 저: "🟢" },
};

function VerdictMatrix({ accountLevel, contextLevel }: { accountLevel: RiskLevel; contextLevel: RiskLevel }) {
  return (
    <div className="verdict-matrix">
      <div className="verdict-matrix-corner" />
      {MATRIX_ORDER.map((c) => (
        <div key={`h-${c}`} className="verdict-matrix-head">
          계좌 {c}
        </div>
      ))}
      {MATRIX_ORDER.map((r) => (
        <Fragment key={`row-${r}`}>
          <div className="verdict-matrix-head">맥락 {r}</div>
          {MATRIX_ORDER.map((c) => {
            const active = r === contextLevel && c === accountLevel;
            return (
              <div key={`${r}-${c}`} className={`verdict-matrix-cell ${active ? "active" : ""}`}>
                {MATRIX_RESULT[c][r]}
              </div>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}

export default function RiskBreakdown({ account, context, questions }: Props) {
  return (
    <div className="risk-breakdown">
      <div className="risk-stage">
        <div className="risk-stage-header">
          <span>1단계 · 계좌 신호</span>
          <span className="risk-stage-total">
            {account.total_score}점 · {account.level}
          </span>
        </div>
        {SIGNAL_ORDER.map((key) => {
          const s = account.signals.find((x) => x.signal === key);
          if (!s) return null;
          const meta = SIGNAL_META[key];
          return (
            <BarRow key={key} label={meta.label} score={s.score} max={meta.max} hit={s.hit} tooltip={s.detail} />
          );
        })}
      </div>

      <div className="risk-stage">
        <div className="risk-stage-header">
          <span>2단계 · 맥락 분석</span>
          <span className="risk-stage-total">
            {context ? `${context.total_score}점 · ${context.level}` : "미실행(질문 없음)"}
            {context?.hard_override ? " · 하드오버라이드" : ""}
          </span>
        </div>

        {!context && <p className="bar-row-empty">저위험 확인 1탭 경로라 2단계 질문 자체가 실행되지 않았어요.</p>}

        {context?.answers.map((a) => {
          const q = questions.find((qq) => qq.question_id === a.question_id);
          const choice = q?.choices.find((c) => c.choice_id === a.choice_id);
          const qLabel = a.question_id === "safety" ? "안전질문" : "공감형 질문";
          return (
            <BarRow
              key={a.question_id}
              label={`${qLabel} 답변`}
              score={a.choice_weight}
              max={CONTEXT_ITEM_MAX}
              hit={a.choice_weight > 0}
              tooltip={choice?.label ?? a.choice_id}
            />
          );
        })}

        {context && (
          <BarRow
            label="대화 입력·첨부"
            score={context.used_input_or_attachment ? 10 : 0}
            max={10}
            hit={context.used_input_or_attachment}
            tooltip={context.used_input_or_attachment ? "텍스트 또는 첨부자료를 제출함" : "입력 없이 건너뛰었음"}
          />
        )}

        {context?.rag && (
          <BarRow
            label={`RAG 매칭: ${context.rag.hit ? context.rag.matched_type : "매칭없음"}`}
            score={context.rag.score}
            max={50}
            hit={context.rag.hit}
            tooltip={
              context.rag.hit
                ? `유사도 ${context.rag.similarity.toFixed(2)} · ${context.rag.source} · 위험신호: ${context.rag.risk_signals.join(", ")}`
                : `유사도 ${context.rag.similarity.toFixed(2)} (임계값 0.60 미만이라 매칭 처리 안 됨)`
            }
          />
        )}
      </div>

      <div className="risk-stage">
        <div className="risk-stage-header">
          <span>3단계 · 최종 판정 매트릭스</span>
        </div>
        <VerdictMatrix accountLevel={account.level} contextLevel={context?.level ?? "저"} />
      </div>
    </div>
  );
}
