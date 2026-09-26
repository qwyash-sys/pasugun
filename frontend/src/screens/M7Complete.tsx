import AppBar from "../components/AppBar";
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
      <div className="spacer" />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>{isDelayed ? "⏳" : "✅"}</div>
        <h1 className="title">{isDelayed ? "지연이체로 접수됐어요" : "송금 완료"}</h1>
        <p className="subtitle">
          {payeeName}님께 {amount.toLocaleString()}원{isDelayed ? "을 지연이체로 예약했어요." : "을 보냈어요."}
        </p>
        {isDelayed && (
          <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "0 8px" }}>
            보이스피싱이 의심되는 거래라 안전을 위해 일정 시간 후 처리돼요. 그 사이 언제든 취소하거나
            영업점·112·1332로 확인할 수 있어요.
          </p>
        )}
        {role === "admin" && (
          <p style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
            판정 근거: 계좌위험 {final.account_level} · 맥락위험 {final.context_level} · 최종 {final.final}
          </p>
        )}
      </div>
      <div className="spacer" />
      <button className="btn btn-secondary" onClick={onRestart}>
        다시 시작
      </button>
    </>
  );
}
