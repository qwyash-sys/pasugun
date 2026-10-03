import AppBar from "../components/AppBar";
import StatusMark from "../components/StatusMark";
import type { Role } from "../roles";
import type { FinalRisk } from "../types";

interface Props {
  role: Role;
  final: FinalRisk;
  payeeName: string;
  amount: number;
  onRestart: () => void;
}

export default function M7Complete({ role, final, payeeName, amount, onRestart }: Props) {
  const isDelayed = final.final === "위험";

  return (
    <>
      <AppBar title={isDelayed ? "지연이체 접수" : "이체완료"} onHome={onRestart} />

      <div className={`complete-hero ${isDelayed ? "pending" : "done"}`}>
        <StatusMark kind={isDelayed ? "pending" : "done"} />
        <h1 className="complete-title">{isDelayed ? "지연이체로 접수됐어요" : "송금을 완료했어요"}</h1>
        <p className="complete-to">{payeeName}님께</p>
        <div className="complete-amount">{amount.toLocaleString()}원</div>
      </div>

      <dl className="info-list boxed">
        <div>
          <dt>받는 분</dt>
          <dd>{payeeName}</dd>
        </div>
        <div>
          <dt>처리 방식</dt>
          <dd className={isDelayed ? "warn" : "em"}>{isDelayed ? "지연이체 · 일정 시간 후 처리" : "즉시 이체"}</dd>
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
            보이스피싱이 의심되는 거래라 안전을 위해 일정 시간 후 처리돼요. 그 사이 언제든 취소하거나
            영업점·112·1332로 확인할 수 있어요.
          </p>
          <p className="delayed-callback">📞 지연이체 진행 전 고객센터에서 최대한 빠르게 확인상담 연락을 드릴 거예요.</p>
        </>
      )}

      <div className="spacer" />
      <button className="btn btn-primary" onClick={onRestart}>
        확인
      </button>
    </>
  );
}
