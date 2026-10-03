import { useEffect, useState } from "react";
import AppBar from "../components/AppBar";
import BankBadge from "../components/BankBadge";
import { BANK_OPTIONS } from "../demoData/banks";
import type { BackendClient } from "../api/client";
import type { DemoCase } from "../demoData/cases";
import type { TestScenario } from "../demoData/testScenarios";
import type { QuoteResponse } from "../types";

const QUOTE_DEBOUNCE_MS = 400;
// 계좌번호는 숫자와 하이픈만 — 붙여넣기로 공백·문자가 섞여도 걸러낸다.
const sanitizeAccount = (v: string) => v.replace(/[^0-9-]/g, "").slice(0, 24);

interface Props {
  demoCase?: DemoCase;
  scenario?: TestScenario;
  customerId: string;
  amount: number;
  client: BackendClient;
  onBack: () => void;
  onNext: (quote: QuoteResponse, sessionId: string) => void;
  onHome: () => void;
}

export default function M2Payee({ demoCase, scenario, customerId, amount, client, onBack, onNext, onHome }: Props) {
  const [bank, setBank] = useState(demoCase?.input.payeeBank ?? scenario?.payeeBank ?? BANK_OPTIONS[0]);
  const [account, setAccount] = useState(demoCase?.input.payeeAccount ?? scenario?.payeeAccount ?? "");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // SPEC 6-0: 계좌 입력이 끝난 시점에 1단계 신호를 백그라운드로 미리 실행한다. 한 글자마다
  // 조회하면 계좌번호 하나 치는 동안 세션이 십수 개 생기고 "조회 중"이 깜빡이므로, 입력이 멈추고
  // 잠깐 뒤에 한 번만 조회한다(데모는 미리 채워진 값이라 바로).
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    setLoading(true);
    setQuote(null);
    setError(null);
    const timer = setTimeout(() => runQuote(), demoCase ? 0 : QUOTE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };

    function runQuote() {
    client
      .quote({
        customer_id: customerId,
        payee_account: account,
        amount,
        current_time: scenario?.currentTime ?? new Date().toISOString(),
        context_overrides: scenario?.overrides,
      })
      .then((q) => {
        if (!cancelled) setQuote(q);
      })
      .catch(() => {
        if (!cancelled) setError("계좌 확인 중 문제가 발생했어요. 계좌번호를 확인하고 다시 시도해주세요.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, bank]);

  const unverified = quote?.payee_verified === false;

  return (
    <>
      <AppBar title="수취계좌" onBack={onBack} onHome={onHome} />
      <p className="subtitle">{amount.toLocaleString()}원을 보낼 계좌를 알려주세요.</p>

      <div className="field-label">은행</div>
      <select value={bank} onChange={(e) => setBank(e.target.value)} disabled={!!demoCase}>
        {BANK_OPTIONS.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>

      <div className="field-label">계좌번호</div>
      <input
        type="text"
        value={account}
        onChange={(e) => setAccount(sanitizeAccount(e.target.value))}
        placeholder="계좌번호 입력 (숫자만, - 없이도 돼요)"
        inputMode="numeric"
        autoComplete="off"
        disabled={!!demoCase}
      />

      {account && (
        <div className="card">
          {loading && <span>예금주 조회 중...</span>}
          {!loading && error && <span style={{ color: "var(--danger)" }}>{error}</span>}
          {!loading && !error && unverified && (
            <div className="payee-unverified">
              <strong>조회되지 않는 계좌예요</strong>
              <span>은행과 계좌번호를 다시 확인해주세요. 개발용 테스트는 이전 화면의 테스트 시나리오를 눌러 등록된 계좌로 채울 수 있어요.</span>
            </div>
          )}
          {!loading && !error && quote && !unverified && (
            <div className="recipient-row">
              <BankBadge bank={quote.payee_bank || bank} />
              <div>
                <div className="name">{quote.payee_name}</div>
                <div className="sub">{quote.payee_bank || bank} · 예금주 확인됨</div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="spacer" />
      <button
        className="btn btn-primary"
        disabled={!quote || loading || unverified}
        onClick={() => quote && onNext(quote, quote.session_id)}
      >
        송금
      </button>
    </>
  );
}
