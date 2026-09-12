import TopBar from "../components/TopBar";
import type { FinalRisk } from "../types";

interface Props {
  final: FinalRisk;
  payeeName: string;
  amount: number;
  onRestart: () => void;
}

export default function M7Complete({ final, payeeName, amount, onRestart }: Props) {
  return (
    <>
      <TopBar />
      <div className="spacer" />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
        <h1 className="title">송금 완료</h1>
        <p className="subtitle">
          {payeeName}님께 {amount.toLocaleString()}원을 보냈어요.
        </p>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
          판정 근거: 계좌위험 {final.account_level} · 맥락위험 {final.context_level} · 최종 {final.final}
        </p>
      </div>
      <div className="spacer" />
      <button className="btn btn-secondary" onClick={onRestart}>
        다시 시작
      </button>
    </>
  );
}
