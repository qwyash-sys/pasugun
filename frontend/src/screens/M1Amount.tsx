import { useState } from "react";
import AppBar from "../components/AppBar";
import { CUSTOMER_OPTIONS } from "../demoData/customers";
import type { DemoCase } from "../demoData/cases";

interface Props {
  isDemo: boolean;
  demoCase?: DemoCase;
  onNext: (data: { customerId: string; amount: number }) => void;
}

const QUICK_ADDS = [10_000, 50_000, 100_000, 1_000_000];

function maskAccount(account: string): string {
  const parts = account.split("-");
  if (parts.length < 2) return account;
  return [parts[0], ...parts.slice(1, -1).map((p) => "*".repeat(p.length)), parts.at(-1)].join("-");
}

export default function M1Amount({ isDemo, demoCase, onNext }: Props) {
  const [customerId, setCustomerId] = useState(CUSTOMER_OPTIONS[0].customer_id);
  const [amount, setAmount] = useState(0);

  if (isDemo && demoCase) {
    return (
      <>
        <AppBar title="이체" />
        <div className="account-selector-row">
          <span>출금계좌(본인)</span>
          <span className="balance">NH농협은행 {maskAccount(demoCase.input.customerAccount)}</span>
        </div>
        <div className="amount-prompt">
          얼마를 보낼까요?
          <strong>{demoCase.input.amount.toLocaleString()}원</strong>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => onNext({ customerId: "demo", amount: demoCase.input.amount })}>
          다음
        </button>
      </>
    );
  }

  return (
    <>
      <AppBar title="이체" />
      <div className="field-label">출금계좌(본인)</div>
      <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
        {CUSTOMER_OPTIONS.map((c) => (
          <option key={c.customer_id} value={c.customer_id}>
            {c.label}
          </option>
        ))}
      </select>

      <div className="amount-prompt">
        얼마를 보낼까요?
        <strong>{amount ? amount.toLocaleString() : 0}원</strong>
      </div>

      <div className="pill-row">
        {QUICK_ADDS.map((v) => (
          <button key={v} className="pill" onClick={() => setAmount((a) => a + v)}>
            +{v >= 10000 ? `${v / 10000}만` : v}
          </button>
        ))}
        <button className="pill" onClick={() => setAmount(0)}>
          초기화
        </button>
      </div>

      <input
        type="number"
        value={amount || ""}
        placeholder="직접 입력"
        onChange={(e) => setAmount(Number(e.target.value))}
      />

      <div className="spacer" />
      <button
        className="btn btn-primary"
        disabled={!amount || amount <= 0}
        onClick={() => onNext({ customerId, amount })}
      >
        다음
      </button>
    </>
  );
}
