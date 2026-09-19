import { useState } from "react";
import AppBar from "../components/AppBar";
import { CUSTOMER_OPTIONS } from "../demoData/customers";
import type { DemoCase } from "../demoData/cases";
import { TEST_SCENARIOS, type TestScenario } from "../demoData/testScenarios";

export interface M1Result {
  customerId: string;
  amount: number;
  /** 테스트 시나리오 버튼으로 채운 경우에만: M2 수취계좌·1단계 이벤트 신호를 미리 채운다. */
  scenario?: TestScenario;
}

interface Props {
  isDemo: boolean;
  demoCase?: DemoCase;
  onNext: (data: M1Result) => void;
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
  const [scenario, setScenario] = useState<TestScenario | undefined>();

  function applyScenario(s: TestScenario) {
    setScenario(s);
    setCustomerId(s.customerId);
    setAmount(s.amount);
  }

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
      <div className="test-scenarios">
        <div className="test-scenarios-title">🧪 개발용 테스트 시나리오 — 누르면 아래 값이 채워져요</div>
        <div className="test-scenarios-list">
          {TEST_SCENARIOS.map((s) => (
            <button
              key={s.label}
              className={`test-scenario-btn ${scenario === s ? "active" : ""}`}
              onClick={() => applyScenario(s)}
            >
              {s.label}
              <span>{s.hint}</span>
            </button>
          ))}
        </div>
      </div>

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
        onClick={() => onNext({ customerId, amount, scenario })}
      >
        다음
      </button>
    </>
  );
}
