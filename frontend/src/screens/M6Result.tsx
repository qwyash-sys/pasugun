import { useState } from "react";
import AppBar, { AiTag } from "../components/AppBar";
import RiskBreakdown from "../components/RiskBreakdown";
import BottomSheet from "../components/BottomSheet";
import HotlineSheet, { HOTLINES, type Hotline } from "../components/HotlineSheet";
import type { Role } from "../roles";
import type { AccountAssessment, ContextAssessment, FinalRisk } from "../types";

interface Props {
  role: Role;
  final: FinalRisk;
  account: AccountAssessment;
  context: ContextAssessment | null;
  agentReply: string | null;
  payeeName: string;
  amount: number;
  onProceed: () => void; // 안전/주의/위험(그래도 송금) -> M7
  onCancel: () => void; // 주의(취소) -> 처음으로
  /** 112·1332 안내를 눌러 확인했을 때(위험 건이면 본부 모니터링에 기록). */
  onHotline?: (line: Hotline) => void;
  onBookBranch: () => void; // 위험 -> 영업점 상담 예약
  onViewReport: () => void; // 위험 -> 리포트 보기(관리자)
  onHome: () => void;
}

// 판정별 히어로 카드: 판정 라벨 + 제목을 같은 톤의 옅은 배경 위에 올려, 결과가 한눈에 들어오게 한다.
const VARIANT = {
  안전: { tone: "safe", icon: "✓", title: "안전하게 확인됐어요" },
  주의: { tone: "warn", icon: "!", title: "이런 점이 걱정돼요" },
  위험: { tone: "danger", icon: "!", title: "보이스피싱이 의심돼요" },
} as const;

// 고객에게는 점수·단계·탐지 근거를 보여주지 않는다(탐지 로직이 노출되면 악용 소지).
// 대신 판정에 맞는 다음 행동만 쉬운 말로 안내한다.

const CUSTOMER_GUIDE = {
  안전: "확인된 위험 신호가 없어요. 평소처럼 송금하셔도 괜찮아요.",
  주의: "몇 가지 확인이 필요한 부분이 있어요. 받는 분의 신원을 공식 대표번호로 한 번 더 확인한 뒤 송금해주세요.",
  위험: "보이스피싱 사례와 비슷한 점이 여러 가지 확인됐어요. 잠시 멈추고 아래 방법으로 먼저 확인해보세요.",
} as const;

/** 판정별 '이렇게 확인해보세요' — 점수·근거 대신 고객이 바로 할 수 있는 행동만. */
const CUSTOMER_STEPS: Record<"주의" | "위험", string[]> = {
  주의: ["받는 분의 신원을 공식 대표번호로 직접 확인해요", "'지금 바로' 보내라고 재촉하면 일단 멈춰요"],
  위험: ["통화를 끊고, 상대가 말한 기관의 공식 번호로 직접 확인해요", "가까운 영업점에서 직원과 함께 확인해요", "이미 돈을 보냈거나 압박을 받고 있다면 112(경찰)에 신고해요"],
};

export default function M6Result({
  role,
  final,
  account,
  context,
  agentReply,
  payeeName,
  amount,
  onProceed,
  onCancel,
  onHotline,
  onBookBranch,
  onViewReport,
  onHome,
}: Props) {
  const v = VARIANT[final.final];
  const [confirmingProceed, setConfirmingProceed] = useState(false);
  const [hotline, setHotline] = useState<Hotline | null>(null);
  // 송금 취소는 되돌릴 수 없으니 한 번 더 묻는다.
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const isAdmin = role === "admin";

  return (
    <>
      <AppBar title="이체전 AI 분석결과" onHome={onHome} />
      {final.final !== "안전" && <AiTag />}

      <div className={`verdict-hero tone-${v.tone}`}>
        <div className="verdict-hero-icon" aria-hidden>
          {v.icon}
        </div>
        <div className="verdict-hero-text">
          <span className="verdict-hero-label">{final.final}</span>
          <h1 className="verdict-hero-title">{v.title}</h1>
          <p className="verdict-hero-sub">
            {payeeName}님께 {amount.toLocaleString()}원
          </p>
        </div>
      </div>

      {agentReply && <div className="chat-bubble">{agentReply}</div>}

      {isAdmin ? (
        <RiskBreakdown account={account} context={context} thresholds={final.thresholds} />
      ) : (
        <div className="card customer-guide">
          {final.final === "안전" ? (
            CUSTOMER_GUIDE.안전
          ) : (
            <>
              <strong className="customer-guide-title">이렇게 확인해보세요</strong>
              <ol className="customer-steps">
                {CUSTOMER_STEPS[final.final].map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}

      <div className="spacer" />

      {final.final === "안전" && (
        <button className="btn btn-primary" onClick={onProceed}>
          송금하기
        </button>
      )}

      {final.final === "주의" && (
        <>
          {isAdmin && <p className="subtitle">공식 대표번호로 상대방 신원을 직접 확인해보세요.</p>}
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setConfirmingCancel(true)}>
              취소
            </button>
            <button className="btn btn-primary" onClick={onProceed}>
              그래도 송금
            </button>
          </div>
        </>
      )}

      {final.final === "위험" && (
        <div className="result-actions">
          <p className="subtitle">송금을 막지는 않아요. 다만 안전을 위해 먼저 확인해보시길 권해요.</p>
          {isAdmin && (
            <button className="btn btn-outline" onClick={onViewReport}>
              영업점 리포트 보기
            </button>
          )}
          <button className="btn btn-primary" onClick={onBookBranch}>
            영업점 상담 예약
          </button>
          <button className="btn btn-secondary" onClick={() => setConfirmingProceed(true)}>
            그래도 송금할게요
          </button>
          <div className="btn-row">
            <button
              className="btn btn-secondary"
              onClick={() => {
                setHotline("112");
                onHotline?.("112");
              }}
            >
              {HOTLINES["112"].label}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setHotline("1332");
                onHotline?.("1332");
              }}
            >
              {HOTLINES["1332"].label}
            </button>
          </div>
          <button className="text-btn" onClick={() => setConfirmingCancel(true)}>
            이번 송금 취소하기
          </button>
        </div>
      )}

      {final.final === "위험" && confirmingProceed && (
        <BottomSheet>
          <h2 className="sheet-title">정말 송금하시겠어요?</h2>
          <p className="sheet-body">
            보이스피싱 정황이 있는 거래예요. 진행하면 안전을 위해 지연이체로 접수되고, 처리되기 전까지는 언제든 취소할 수 있어요.
            <br />
            <strong>지연이체 진행 전 고객센터에서 최대한 빠르게 확인상담 연락을 드릴 거예요.</strong>
          </p>
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setConfirmingProceed(false)}>
              다시 확인할게요
            </button>
            <button className="btn btn-danger" onClick={onProceed}>
              지연이체로 진행
            </button>
          </div>
        </BottomSheet>
      )}
      {confirmingCancel && (
        <BottomSheet>
          <h2 className="sheet-title">이번 송금을 취소할까요?</h2>
          <p className="sheet-body">
            {payeeName}님께 보내려던 {amount.toLocaleString()}원을 보내지 않아요. 다시 보내려면 처음부터 이체해야 해요.
          </p>
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setConfirmingCancel(false)}>
              돌아가기
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                setConfirmingCancel(false);
                onCancel();
              }}
            >
              송금 취소
            </button>
          </div>
        </BottomSheet>
      )}
      {hotline && <HotlineSheet hotline={hotline} onClose={() => setHotline(null)} />}
    </>
  );
}
