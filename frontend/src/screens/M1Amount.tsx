import { useState } from "react";
import { koreanAmount } from "../utils/format";
import AppBar from "../components/AppBar";
import { CUSTOMER_OPTIONS } from "../demoData/customers";
import type { DemoCase } from "../demoData/cases";
import type { TestScenario } from "../demoData/testScenarios";

export interface M1Result {
  customerId: string;
  amount: number;
  /** 테스트 시나리오 버튼으로 채운 경우에만: M2 수취계좌·1단계 이벤트 신호를 미리 채운다. */
  scenario?: TestScenario;
}

interface Props {
  isDemo: boolean;
  demoCase?: DemoCase;
  /** 실제 모드에서 시연 케이스를 골라 들어온 경우 그 케이스 이름(값이 미리 채워졌다는 안내용). */
  caseTitle?: string;
  /** 수취계좌 화면에서 뒤로 돌아왔을 때 앞서 입력한 값을 그대로 보여준다. */
  initial?: M1Result;
  onNext: (data: M1Result) => void;
  onHome: () => void;
}

const QUICK_ADDS = [10_000, 50_000, 100_000, 1_000_000];
// 백엔드 TransferRequest.amount 상한과 같다(1회 최대 1,000억원).
const MAX_AMOUNT = 100_000_000_000;

function maskAccount(account: string): string {
  const parts = account.split("-");
  if (parts.length < 2) return account;
  return [parts[0], ...parts.slice(1, -1).map((p) => "*".repeat(p.length)), parts.at(-1)].join("-");
}

export default function M1Amount({ isDemo, demoCase, caseTitle, initial, onNext, onHome }: Props) {
  const [customerId, setCustomerId] = useState(initial?.customerId || CUSTOMER_OPTIONS[0].customer_id);
  const [amount, setAmount] = useState(initial?.amount ?? 0);
  const [scenario] = useState<TestScenario | undefined>(initial?.scenario);
  const tooMuch = amount > MAX_AMOUNT;

  if (isDemo && demoCase) {
    return (
      <>
        <AppBar title="이체" onHome={onHome} />
        <div className="account-selector-row">
          <span>출금계좌(본인)</span>
          <span className="balance">NH농협은행 {maskAccount(demoCase.input.customerAccount)}</span>
        </div>
        <div className="amount-prompt">
          얼마를 보낼까요?
          <strong>{demoCase.input.amount.toLocaleString()}원</strong>
          <span className="amount-korean">{koreanAmount(demoCase.input.amount)}</span>
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
      <AppBar title="이체" onHome={onHome} />
      {caseTitle && <p className="case-prefill-note">💡 ‘{caseTitle}’ 케이스 값이 채워져 있어요. 바꿔서 해봐도 돼요.</p>}

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
        {/* key: 금액이 바뀔 때마다 숫자가 살짝 튀어 올라 입력이 반영됐음을 보여준다 */}
        <strong key={amount} className="amount-bump">
          {amount ? amount.toLocaleString() : 0}원
        </strong>
        {amount > 0 && <span className="amount-korean">{koreanAmount(amount)}</span>}
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

      {/* 숫자만 받아 천 단위 쉼표를 붙여 보여준다(type=number는 소수·e·음수가 들어가고 쉼표가 안 보인다) */}
      <input
        type="text"
        inputMode="numeric"
        value={amount ? amount.toLocaleString() : ""}
        placeholder="직접 입력 (원)"
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, 13);
          setAmount(digits ? Number(digits) : 0);
        }}
      />
      {tooMuch && <p className="field-error">1회 최대 {koreanAmount(MAX_AMOUNT)}까지 보낼 수 있어요.</p>}

      <div className="spacer" />
      <button
        className="btn btn-primary"
        disabled={!amount || amount <= 0 || tooMuch}
        onClick={() => onNext({ customerId, amount, scenario })}
      >
        다음
      </button>
    </>
  );
}
