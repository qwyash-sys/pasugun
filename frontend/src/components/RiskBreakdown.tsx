import { Fragment, useState } from "react";
import {
  ACCOUNT_BANDS,
  CHOICE_LABELS,
  CONTEXT_BANDS,
  CONTEXT_MAX,
  HARD_OVERRIDE_RISK_SIGNALS,
  SIGNAL_META,
  SIGNAL_ORDER,
  STAGE1_SCALE,
  STAGE2_SCALE,
  bandLabel,
  type LevelBand,
} from "./signalMeta";
import type { AccountAssessment, ContextAssessment, RagCandidate, RiskLevel } from "../types";

interface Props {
  account: AccountAssessment;
  context: ContextAssessment | null;
}

/** 막대 하나. 옅은 구간 = 이 항목이 받을 수 있는 최대점, 진한 구간 = 실제 점수.
 * 한 단계 안의 모든 막대는 같은 축(scale)을 쓰므로 40점과 25점의 길이가 실제로 다르다. */
function BarRow({
  label,
  score,
  max,
  scale,
  hit,
  tooltip,
}: {
  label: string;
  score: number;
  max: number;
  scale: number;
  hit: boolean;
  tooltip: string;
}) {
  const [open, setOpen] = useState(false);
  const cap = Math.max(max, score);
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;

  return (
    <div
      className="bar-row"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((o) => !o)}
    >
      <span className="bar-row-label">{label}</span>
      <div className="bar-row-track">
        <div className="bar-row-cap" style={{ width: pct(cap) }} />
        {score > 0 && <div className={`bar-row-fill ${hit ? "hit" : ""}`} style={{ width: pct(score) }} />}
      </div>
      <span className={`bar-row-score ${hit ? "hit" : ""}`}>
        +{score}
        <small>/{cap}</small>
      </span>
      {open && (
        <div className="bar-row-tooltip">
          {tooltip}
          <br />
          {score}점 / 이 항목 최대 {cap}점
        </div>
      )}
    </div>
  );
}

function RagCandidateChart({ candidates, matchedId }: { candidates: RagCandidate[]; matchedId: string | null }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => b.similarity - a.similarity);

  return (
    <div className="rag-candidates">
      <div className="rag-candidates-header">RAG 후보 비교 · 사례집 {sorted.length}건 중 코사인 유사도 순위</div>
      {sorted.map((c) => {
        const isWinner = c.scenario_id === matchedId;
        return (
          <div
            key={c.scenario_id}
            className={`rag-candidate-row ${isWinner ? "winner" : ""}`}
            onMouseEnter={() => setOpenId(c.scenario_id)}
            onMouseLeave={() => setOpenId(null)}
            onClick={() => setOpenId((o) => (o === c.scenario_id ? null : c.scenario_id))}
          >
            <span className="rag-candidate-label">
              {isWinner ? "✅ " : ""}
              {c.scenario_id} · {c.matched_type}
            </span>
            <div className="rag-candidate-track">
              <div className="rag-threshold-mark" style={{ left: "60%" }} />
              <div className="rag-threshold-mark" style={{ left: "80%" }} />
              <div
                className={`rag-candidate-fill ${isWinner ? "winner" : ""}`}
                style={{ width: `${Math.max(1, c.similarity * 100)}%` }}
              />
            </div>
            <span className="rag-candidate-value">{c.similarity.toFixed(2)}</span>
            {openId === c.scenario_id && (
              <div className="bar-row-tooltip">
                {isWinner
                  ? "이 사례가 가장 유사해서 선택됨(임계값: 0.60 이상 30점, 0.80 이상 50점)"
                  : "1등이 아니거나 임계값(0.60)에 못 미쳐 선택되지 않음"}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const MATRIX_ORDER: RiskLevel[] = ["고", "중", "저"];
// [송금위험(계좌)][AI분석(맥락)] — backend app/aggregator.py _MATRIX와 같다.
const MATRIX_RESULT: Record<RiskLevel, Record<RiskLevel, string>> = {
  고: { 고: "🔴", 중: "🔴", 저: "🟡" },
  중: { 고: "🔴", 중: "🟡", 저: "🟢" },
  저: { 고: "🔴", 중: "🟡", 저: "🟢" },
};
const VERDICT_NAME: Record<string, string> = { "🔴": "위험", "🟡": "주의", "🟢": "안전" };

function band(bands: LevelBand[], level: RiskLevel) {
  return bands.find((b) => b.level === level)!;
}

function VerdictMatrix({ accountLevel, contextLevel }: { accountLevel: RiskLevel; contextLevel: RiskLevel }) {
  return (
    <div className="verdict-matrix">
      <div className="verdict-matrix-corner" />
      {MATRIX_ORDER.map((c) => (
        <div key={`h-${c}`} className={`verdict-matrix-head ${c === accountLevel ? "on" : ""}`}>
          송금위험 {c}
          <small>{bandLabel(band(ACCOUNT_BANDS, c))}</small>
        </div>
      ))}
      {MATRIX_ORDER.map((r) => (
        <Fragment key={`row-${r}`}>
          <div className={`verdict-matrix-head ${r === contextLevel ? "on" : ""}`}>
            AI분석 {r}
            <small>{bandLabel(band(CONTEXT_BANDS, r))}</small>
          </div>
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

/** 점수가 저/중/고 구간 중 어디에 떨어지는지 한 줄 게이지로 보여준다. */
function LevelGauge({ title, score, level, bands }: { title: string; score: number; level: RiskLevel; bands: LevelBand[] }) {
  const top = bands[bands.length - 1].from;
  const axisMax = Math.max(top * 2, Math.ceil((score + 10) / 10) * 10);
  const pos = (v: number) => `${Math.min(100, (v / axisMax) * 100)}%`;

  return (
    <div className="level-gauge">
      <div className="level-gauge-head">
        <span>{title}</span>
        <strong>
          {score}점 → {level}
        </strong>
      </div>
      <div className="level-gauge-track">
        {bands.map((b, i) => {
          const end = i + 1 < bands.length ? bands[i + 1].from : axisMax;
          return (
            <div
              key={b.level}
              className={`level-gauge-band band-${b.level} ${b.level === level ? "on" : ""}`}
              style={{ left: pos(b.from), width: `calc(${pos(end)} - ${pos(b.from)})` }}
            >
              {b.level}
            </div>
          );
        })}
        <div className="level-gauge-marker" style={{ left: pos(score) }} />
      </div>
      <div className="level-gauge-legend">
        {bands.map((b) => (
          <span key={b.level}>
            {b.level} {bandLabel(b)}
          </span>
        ))}
      </div>
    </div>
  );
}

function hardOverrideCauses(context: ContextAssessment): string[] {
  const causes: string[] = [];
  const answer = context.answers.find((a) => a.hard_override);
  if (answer) causes.push(`안전질문 "${CHOICE_LABELS[answer.choice_id] ?? answer.choice_id}" 응답`);
  if (context.rag?.hit) {
    const hits = context.rag.risk_signals.filter((s) => HARD_OVERRIDE_RISK_SIGNALS.includes(s));
    if (hits.length) causes.push(`RAG 위험신호(${hits.join(", ")}) 직접 매칭`);
  }
  return causes;
}

function VerdictBasis({ account, context }: Props) {
  const contextLevel: RiskLevel = context?.level ?? "저";
  const matrixMark = MATRIX_RESULT[account.level][contextLevel];
  const hardOverride = !!context?.hard_override;
  const scoreBasedContext = context
    ? (CONTEXT_BANDS.slice().reverse().find((b) => context.total_score >= b.from)?.level ?? "저")
    : "저";

  return (
    <div className="verdict-basis">
      <LevelGauge title="1단계 송금위험도 점수" score={account.total_score} level={account.level} bands={ACCOUNT_BANDS} />
      {context ? (
        <LevelGauge title="2단계 AI분석 점수" score={context.total_score} level={scoreBasedContext} bands={CONTEXT_BANDS} />
      ) : (
        <p className="verdict-basis-note">2단계 미실행(확인 1탭 경로) → AI분석 저로 계산</p>
      )}
      {hardOverride && context && (
        <p className="verdict-basis-note danger">
          결정적 피싱징후: {hardOverrideCauses(context).join(" · ") || "위험신호 직접 확인"}
          <br />→ 점수와 무관하게 AI분석 <strong>고</strong>, 최종 <strong>위험</strong>으로 고정
        </p>
      )}
      <p className="verdict-basis-result">
        송금위험 <strong>{account.level}</strong> × AI분석 <strong>{contextLevel}</strong> → 매트릭스{" "}
        <strong>
          {matrixMark} {VERDICT_NAME[matrixMark]}
        </strong>
        {hardOverride && matrixMark !== "🔴" && " (결정적 피싱징후로 위험 적용)"}
      </p>
    </div>
  );
}

export default function RiskBreakdown({ account, context }: Props) {
  return (
    <div className="risk-breakdown">
      <div className="risk-stage">
        <div className="risk-stage-header">
          <span>1단계 · 송금위험도 판단</span>
          <span className="risk-stage-total">
            {account.total_score}점 · {account.level}
          </span>
        </div>
        <p className="risk-stage-legend">막대 축 공통 {STAGE1_SCALE}점 · 옅은 구간 = 항목 최대점</p>
        {SIGNAL_ORDER.map((key) => {
          const s = account.signals.find((x) => x.signal === key);
          if (!s) return null;
          const meta = SIGNAL_META[key];
          return (
            <BarRow
              key={key}
              label={meta.label}
              score={s.score}
              max={meta.max}
              scale={STAGE1_SCALE}
              hit={s.hit}
              tooltip={s.detail}
            />
          );
        })}
      </div>

      <div className="risk-stage">
        <div className="risk-stage-header">
          <span>2단계 · AI 분석</span>
          <span className="risk-stage-total">
            {context ? `${context.total_score}점 · ${context.level}` : "미실행(질문 없음)"}
            {context?.hard_override ? " · 결정적 피싱징후" : ""}
          </span>
        </div>

        {!context && <p className="bar-row-empty">저위험 확인 1탭 경로라 2단계 질문 자체가 실행되지 않았어요.</p>}
        {context && <p className="risk-stage-legend">막대 축 공통 {STAGE2_SCALE}점 · 옅은 구간 = 항목 최대점</p>}

        {context?.answers.map((a) => {
          const isSafety = a.question_id === "safety";
          return (
            <BarRow
              key={a.question_id}
              label={`${isSafety ? "안전질문" : "공감형 질문"} 답변`}
              score={a.choice_weight}
              max={isSafety ? CONTEXT_MAX.safety : CONTEXT_MAX.empathy}
              scale={STAGE2_SCALE}
              hit={a.choice_weight > 0}
              tooltip={`선택: ${CHOICE_LABELS[a.choice_id] ?? a.choice_id}`}
            />
          );
        })}

        {context && (
          <BarRow
            label="대화 입력·첨부"
            score={context.used_input_or_attachment ? 10 : 0}
            max={CONTEXT_MAX.input}
            scale={STAGE2_SCALE}
            hit={context.used_input_or_attachment}
            tooltip={context.used_input_or_attachment ? "텍스트 또는 첨부자료를 제출함" : "입력 없이 건너뛰었음"}
          />
        )}

        {context?.rag && (
          <>
            <BarRow
              label={`RAG 매칭: ${context.rag.hit ? context.rag.matched_type : "매칭없음"}`}
              score={context.rag.score}
              max={CONTEXT_MAX.rag}
              scale={STAGE2_SCALE}
              hit={context.rag.hit}
              tooltip={
                context.rag.hit
                  ? `유사도 ${context.rag.similarity.toFixed(2)} · ${context.rag.source} · 위험신호: ${context.rag.risk_signals.join(", ")}`
                  : `최고 유사도 ${context.rag.similarity.toFixed(2)} (임계값 0.60 미만이라 매칭 처리 안 됨)`
              }
            />
            <RagCandidateChart candidates={context.rag.candidates} matchedId={context.rag.matched_id} />
          </>
        )}
      </div>

      <div className="risk-stage">
        <div className="risk-stage-header">
          <span>3단계 · 최종 판정 매트릭스</span>
        </div>
        <VerdictMatrix accountLevel={account.level} contextLevel={context?.level ?? "저"} />
        <VerdictBasis account={account} context={context} />
      </div>
    </div>
  );
}
