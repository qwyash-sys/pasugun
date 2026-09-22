import AppBar from "../components/AppBar";
import BankBadge from "../components/BankBadge";
import BottomSheet from "../components/BottomSheet";

interface Props {
  payeeBank: string;
  payeeName: string;
  amount: number;
  onConfirm: () => void;
  onCancel: () => void;
  onHome: () => void;
}

// 실제 올원뱅크 "한 번 더 확인해 주세요" 팝업(신규계좌 안내)을 그대로 따른다.
export default function M3Confirm({ payeeBank, payeeName, amount, onConfirm, onCancel, onHome }: Props) {
  return (
    <>
      <div className="sheet-behind">
        <AppBar title="이체확인" onHome={onHome} />
        <div className="card">
          <div className="recipient-row">
            <BankBadge bank={payeeBank} />
            <div>
              <div className="name">{payeeName}</div>
              <div className="sub">
                {payeeBank} · {amount.toLocaleString()}원
              </div>
            </div>
          </div>
        </div>
      </div>

      <BottomSheet>
        <h1 className="title" style={{ textAlign: "center" }}>
          한 번 더 확인해 주세요
        </h1>
        <p style={{ textAlign: "center", color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 22 }}>
          최근에 송금한 적 없는 계좌입니다.
          <br />
          <strong style={{ color: "var(--text)" }}>{payeeName}</strong>님에게 이체하시겠어요?
        </p>
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={onCancel}>
            취소
          </button>
          <button className="btn btn-primary" onClick={onConfirm}>
            확인
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
