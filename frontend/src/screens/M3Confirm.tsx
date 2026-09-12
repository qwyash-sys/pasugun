import TopBar from "../components/TopBar";

interface Props {
  payeeName: string;
  amount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function M3Confirm({ payeeName, amount, onConfirm, onCancel }: Props) {
  return (
    <>
      <TopBar />
      <div className="spacer" />
      <div className="card" style={{ textAlign: "center" }}>
        <p style={{ fontSize: 15, lineHeight: 1.6 }}>
          최근 보낸 적 없는 분이에요.
          <br />
          <strong>{payeeName}</strong>님께 {amount.toLocaleString()}원을 이체할까요?
        </p>
      </div>
      <div className="spacer" />
      <div className="btn-row">
        <button className="btn btn-secondary" onClick={onCancel}>
          취소
        </button>
        <button className="btn btn-primary" onClick={onConfirm}>
          확인
        </button>
      </div>
    </>
  );
}
