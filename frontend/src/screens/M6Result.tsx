import AppBar, { AiTag } from "../components/AppBar";
import type { FinalRisk } from "../types";

interface Props {
  final: FinalRisk;
  agentReply: string | null;
  payeeName: string;
  amount: number;
  onProceed: () => void; // 안전/주의(그래도 송금) -> M7
  onCancel: () => void; // 주의(취소) -> 처음으로
  onViewReport: () => void; // 위험 -> 리포트 보기
}

const VARIANT = {
  안전: { badgeClass: "verdict-safe", emoji: "🟢", title: "안전하게 확인됐어요" },
  주의: { badgeClass: "verdict-warn", emoji: "🟡", title: "이런 점이 걱정돼요" },
  위험: { badgeClass: "verdict-danger", emoji: "🔴", title: "보이스피싱이 의심돼요" },
} as const;

export default function M6Result({ final, agentReply, payeeName, amount, onProceed, onCancel, onViewReport }: Props) {
  const v = VARIANT[final.final];

  return (
    <>
      <AppBar title="이체결과" />
      {final.final !== "안전" && <AiTag />}
      <span className={`verdict-badge ${v.badgeClass}`}>
        {v.emoji} {final.final}
      </span>
      <h1 className="title">{v.title}</h1>
      <p className="subtitle">
        {payeeName}님께 {amount.toLocaleString()}원
      </p>

      {agentReply && <div className="chat-bubble">{agentReply}</div>}

      <div className="card">
        <div className="field-label">판단 근거</div>
        <ul className="reason-list">
          {final.reasons.length === 0 && <li>특이 신호 없음</li>}
          {final.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </div>

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

      {final.final === "위험" && (
        <>
          <p className="subtitle">이체를 잠시 보류했어요. 아래 방법으로 확인해보세요.</p>
          <div className="btn-row" style={{ marginBottom: 10 }}>
            <button className="btn btn-outline" onClick={onViewReport}>
              영업점 리포트 보기
            </button>
          </div>
          <div className="btn-row">
            <button className="btn btn-secondary">112 신고</button>
            <button className="btn btn-secondary">1332 상담</button>
          </div>
        </>
      )}
    </>
  );
}
