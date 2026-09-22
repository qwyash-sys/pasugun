import { useState } from "react";
import AppBar, { AiTag } from "../components/AppBar";
import RiskBreakdown from "../components/RiskBreakdown";
import type { AccountAssessment, ContextAssessment, FinalRisk, Question } from "../types";

interface Props {
  final: FinalRisk;
  account: AccountAssessment;
  context: ContextAssessment | null;
  questions: Question[];
  agentReply: string | null;
  payeeName: string;
  amount: number;
  onProceed: () => void; // 안전/주의/위험(그래도 송금) -> M7
  onCancel: () => void; // 주의(취소) -> 처음으로
  onViewReport: () => void; // 위험 -> 리포트 보기
  onHome: () => void;
}

const VARIANT = {
  안전: { badgeClass: "verdict-safe", emoji: "🟢", title: "안전하게 확인됐어요" },
  주의: { badgeClass: "verdict-warn", emoji: "🟡", title: "이런 점이 걱정돼요" },
  위험: { badgeClass: "verdict-danger", emoji: "🔴", title: "보이스피싱이 의심돼요" },
} as const;

export default function M6Result({
  final,
  account,
  context,
  questions,
  agentReply,
  payeeName,
  amount,
  onProceed,
  onCancel,
  onViewReport,
  onHome,
}: Props) {
  const v = VARIANT[final.final];
  const [confirmingProceed, setConfirmingProceed] = useState(false);

  return (
    <>
      <AppBar title="이체결과" onHome={onHome} />
      {final.final !== "안전" && <AiTag />}
      <span className={`verdict-badge ${v.badgeClass}`}>
        {v.emoji} {final.final}
      </span>
      <h1 className="title">{v.title}</h1>
      <p className="subtitle">
        {payeeName}님께 {amount.toLocaleString()}원
      </p>

      {agentReply && <div className="chat-bubble">{agentReply}</div>}

      <RiskBreakdown account={account} context={context} questions={questions} />

      <div className="spacer" />

      {final.final === "안전" && (
        <button className="btn btn-primary" onClick={onProceed}>
          송금하기
        </button>
      )}

      {final.final === "주의" && (
        <>
          <p className="subtitle">공식 대표번호로 상대방 신원을 직접 확인해보세요.</p>
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={onCancel}>
              취소
            </button>
            <button className="btn btn-primary" onClick={onProceed}>
              그래도 송금
            </button>
          </div>
        </>
      )}

      {final.final === "위험" && !confirmingProceed && (
        <>
          <p className="subtitle">
            송금을 막지는 않아요. 다만 안전을 위해 아래 방법으로 먼저 확인해보시길 권해요.
          </p>
          <div className="btn-row" style={{ marginBottom: 10 }}>
            <button className="btn btn-outline" onClick={onViewReport}>
              영업점 리포트 보기
            </button>
          </div>
          <div className="btn-row" style={{ marginBottom: 14 }}>
            <button className="btn btn-secondary">112 신고</button>
            <button className="btn btn-secondary">1332 상담</button>
          </div>
          <button
            className="btn btn-secondary"
            style={{ background: "none", color: "var(--text-muted)", fontSize: 13, textDecoration: "underline" }}
            onClick={() => setConfirmingProceed(true)}
          >
            그래도 송금할게요
          </button>
        </>
      )}

      {final.final === "위험" && confirmingProceed && (
        <div className="card" style={{ borderColor: "var(--danger)" }}>
          <p style={{ fontWeight: 700, marginBottom: 8 }}>정말 진행하시겠어요?</p>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
            보이스피싱 정황이 있는 거래예요. 지금 진행하면 안전을 위해 지연이체로 접수되고, 접수 후에도
            일정 시간 동안은 취소할 수 있어요.
          </p>
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setConfirmingProceed(false)}>
              다시 확인할게요
            </button>
            <button className="btn btn-danger" onClick={onProceed}>
              지연이체로 진행
            </button>
          </div>
        </div>
      )}
    </>
  );
}
