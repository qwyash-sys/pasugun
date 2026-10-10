import { useState } from "react";
import AppBar from "../components/AppBar";
import BottomSheet from "../components/BottomSheet";
import StatusMark from "../components/StatusMark";
import type { Role } from "../roles";
import type { FinalRisk } from "../types";

interface Props {
  role: Role;
  final: FinalRisk;
  payeeName: string;
  amount: number;
  /** 결과 화면에서 고객이 송금을 취소하고 들어온 경우(출금 없음). */
  cancelled?: boolean;
  /** 지연이체를 실행 전에 직접 취소했을 때 본부 모니터링에 알린다. */
  onCancelDelayed?: () => void;
  onRestart: () => void;
}

/** 지연이체는 접수 2시간 뒤 처리된다(본부 모니터링의 지연 해제 시각과 같은 기준). */
const DELAY_MS = 2 * 3600_000;

/** 처리 예정 시각(KST)을 "오늘 15:30" / "내일 00:18"처럼. */
function kstWhen(d: Date, now: Date = new Date()): string {
  const k = new Date(d.getTime() + 9 * 3600_000);
  const day = (x: Date) => new Date(x.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  const hm = `${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
  return `${day(d) === day(now) ? "오늘" : "내일"} ${hm}`;
}

export default function M7Complete({ role, final, payeeName, amount, cancelled = false, onCancelDelayed, onRestart }: Props) {
  const [releaseAt] = useState(() => new Date(Date.now() + DELAY_MS));
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelledDelayed, setCancelledDelayed] = useState(false);
  const isCancelled = cancelled || cancelledDelayed;
  const isDelayed = final.final === "위험" && !isCancelled;

  const title = isCancelled ? "송금 취소" : isDelayed ? "지연이체 접수" : "이체완료";

  return (
    <>
      <AppBar title={title} onHome={onRestart} />

      <div className={`complete-hero ${isCancelled ? "cancel" : isDelayed ? "pending" : "done"}`}>
        <StatusMark kind={isCancelled ? "cancel" : isDelayed ? "pending" : "done"} />
        <h1 className="complete-title">{isCancelled ? (cancelledDelayed ? "지연이체를 취소했어요" : "송금을 취소했어요") : isDelayed ? "지연이체로 접수됐어요" : "송금을 완료했어요"}</h1>
        <p className="complete-to">{payeeName}님께</p>
        <div className={`complete-amount ${isCancelled ? "struck" : ""}`}>{amount.toLocaleString()}원</div>
      </div>

      <dl className="info-list boxed">
        <div>
          <dt>받는 분</dt>
          <dd>{payeeName}</dd>
        </div>
        <div>
          <dt>처리 결과</dt>
          <dd className={isCancelled ? "" : isDelayed ? "warn" : "em"}>
            {isCancelled ? "출금되지 않았어요" : isDelayed ? `지연이체 · ${kstWhen(releaseAt)} 이후 처리` : "즉시 이체"}
          </dd>
        </div>
        {role === "admin" && (
          <div>
            <dt>판정 근거</dt>
            <dd>
              송금위험 {final.account_level} · AI분석 {final.context_level} · 최종 {final.final}
            </dd>
          </div>
        )}
      </dl>

      {isDelayed && (
        <>
          <p className="complete-note">
            보이스피싱이 의심되는 거래라 안전을 위해 일정 시간 후 처리돼요. 처리 전까지는 아래 버튼으로 언제든 취소할 수 있고,
            영업점·112·1332로 확인할 수도 있어요.
          </p>
          <p className="delayed-callback">📞 지연이체 진행 전 고객센터에서 최대한 빠르게 확인상담 연락을 드릴 거예요.</p>
        </>
      )}
      {isCancelled && <p className="complete-note">잘하셨어요. 의심되는 연락을 받으셨다면 112(경찰) 또는 1332(금융감독원)에 알려주세요.</p>}

      <div className="spacer" />
      {isDelayed && (
        <button className="btn btn-secondary btn-gap" onClick={() => setConfirmCancel(true)}>
          지연이체 취소하기
        </button>
      )}
      <button className="btn btn-primary" onClick={onRestart}>
        확인
      </button>

      {confirmCancel && (
        <BottomSheet>
          <h2 className="sheet-title">지연이체를 취소할까요?</h2>
          <p className="sheet-body">취소하면 {amount.toLocaleString()}원은 보내지지 않아요. 다시 보내려면 처음부터 이체해야 해요.</p>
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setConfirmCancel(false)}>
              유지할게요
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                onCancelDelayed?.();
                setCancelledDelayed(true);
                setConfirmCancel(false);
              }}
            >
              취소하기
            </button>
          </div>
        </BottomSheet>
      )}
    </>
  );
}
