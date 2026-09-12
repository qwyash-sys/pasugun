import { useState } from "react";
import TopBar from "../components/TopBar";
import { CUSTOMER_OPTIONS } from "../demoData/customers";
import type { DemoCase } from "../demoData/cases";

interface Props {
  isDemo: boolean;
  demoCase?: DemoCase;
  onNext: (data: { customerId: string; amount: number }) => void;
}

export default function M1Amount({ isDemo, demoCase, onNext }: Props) {
  const [customerId, setCustomerId] = useState(CUSTOMER_OPTIONS[0].customer_id);
  const [amount, setAmount] = useState(demoCase ? demoCase.input.amount : 0);

  if (isDemo && demoCase) {
    return (
      <>
        <TopBar />
        <h1 className="title">송금액 입력</h1>
        <p className="subtitle">출금계좌 351-****-{demoCase.input.customerName === "박지훈" ? "0004" : "0001"} (본인)</p>
        <div className="amount-display">{demoCase.input.amount.toLocaleString()}원</div>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => onNext({ customerId: "demo", amount: demoCase.input.amount })}>
          다음
        </button>
      </>
    );
  }

  return (
    <>
      <TopBar />
      <h1 className="title">송금액 입력</h1>
      <p className="subtitle">테스트할 고객과 금액을 입력하세요.</p>
      <div className="field-label">출금계좌 (본인)</div>
      <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
        {CUSTOMER_OPTIONS.map((c) => (
          <option key={c.customer_id} value={c.customer_id}>
            {c.label}
          </option>
        ))}
      </select>
      <div className="field-label">송금액</div>
      <input
        type="number"
        value={amount || ""}
        placeholder="0"
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
