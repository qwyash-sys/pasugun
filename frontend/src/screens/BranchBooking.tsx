import { useState } from "react";
import AppBar from "../components/AppBar";
import { NEAREST_BRANCH, VISIT_PURPOSE, planBranchVisit, visitGuide } from "../utils/branchVisit";

interface Props {
  customerName: string;
  onBack: () => void;
  onHome: () => void;
}

// 위험 판정 후 "영업점 상담 예약": 가까운 영업점을 안내 → 올원뱅크 영업점 방문예약 화면으로
// 넘어가 확인만 누르면 → 예약 완료. 실제 예약 연동 없이 흐름만 재현한다(데모·실제 모드 동일).
export default function BranchBooking({ customerName, onBack, onHome }: Props) {
  // 화면에 들어온 순간 기준으로 한 번만 계산한다(머무는 동안 시간이 바뀌어도 예약 시간이 흔들리지 않게).
  const [plan] = useState(() => planBranchVisit());
  const [step, setStep] = useState<"guide" | "allone" | "done">("guide");
  const when = `${plan.dateLabel} ${plan.time}`;

  if (step === "guide") {
    return (
      <>
        <AppBar title="영업점 상담 예약" onBack={onBack} onHome={onHome} />
        <div className="booking-hero">
          <div className="booking-hero-icon">🏦</div>
          <h1 className="title">영업점에서 직접 확인받아 보세요</h1>
          <p className="booking-guide">{visitGuide(plan)}</p>
        </div>

        <div className="booking-card">
          <div className="booking-card-head">
            <strong>{NEAREST_BRANCH.name}</strong>
            <span className="tag">가장 가까운 영업점 · {NEAREST_BRANCH.distance}</span>
          </div>
          <dl className="info-list">
            <div>
              <dt>위치</dt>
              <dd>{NEAREST_BRANCH.area}</dd>
            </div>
            <div>
              <dt>영업시간</dt>
              <dd>평일 09:00 ~ 16:00</dd>
            </div>
            <div>
              <dt>예약 시간</dt>
              <dd className="em">{when}</dd>
            </div>
          </dl>
        </div>

        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => setStep("allone")}>
          올원뱅크 영업점 방문예약으로 이동
        </button>
      </>
    );
  }

  if (step === "allone") {
    return (
      <>
        <AppBar title="영업점 방문예약" onBack={() => setStep("guide")} onHome={onHome} />
        <p className="booking-brand">올원뱅크 · 영업점 방문예약</p>
        <h1 className="title">예약 내용을 확인해주세요</h1>
        <p className="subtitle">확인을 누르면 바로 예약돼요.</p>

        <dl className="info-list boxed">
          <div>
            <dt>방문 영업점</dt>
            <dd>{NEAREST_BRANCH.name}</dd>
          </div>
          <div>
            <dt>방문 일시</dt>
            <dd className="em">{when}</dd>
          </div>
          <div>
            <dt>상담 업무</dt>
            <dd>{VISIT_PURPOSE}</dd>
          </div>
          <div>
            <dt>예약자</dt>
            <dd>{customerName}</dd>
          </div>
        </dl>

        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => setStep("done")}>
          확인
        </button>
      </>
    );
  }

  return (
    <>
      <AppBar title="예약 완료" onHome={onHome} />
      <div className="spacer" />
      <div className="booking-hero">
        <div className="booking-hero-icon done">✓</div>
        <h1 className="title">영업점 방문 예약이 완료되었어요</h1>
        <p className="booking-guide">예약 시간에 신분증을 가지고 방문해주세요. 송금은 상담 후 진행하시면 돼요.</p>
      </div>
      <div className="booking-ticket">
        <div className="booking-ticket-branch">{NEAREST_BRANCH.name}</div>
        <div className="booking-ticket-time">{when}</div>
        <div className="booking-ticket-purpose">{VISIT_PURPOSE}</div>
      </div>
      <div className="spacer" />
      <button className="btn btn-primary" onClick={onHome}>
        처음으로
      </button>
    </>
  );
}
