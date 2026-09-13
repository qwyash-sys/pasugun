import { useEffect, useState } from "react";
import AppBar from "../components/AppBar";
import BankBadge from "../components/BankBadge";
import { BANK_OPTIONS } from "../demoData/banks";
import type { BackendClient } from "../api/client";
import type { DemoCase } from "../demoData/cases";
import type { QuoteResponse } from "../types";

interface Props {
  demoCase?: DemoCase;
  customerId: string;
  amount: number;
  client: BackendClient;
  onBack: () => void;
  onNext: (quote: QuoteResponse, sessionId: string) => void;
}

export default function M2Payee({ demoCase, customerId, amount, client, onBack, onNext }: Props) {
  const [bank, setBank] = useState(demoCase?.input.payeeBank ?? BANK_OPTIONS[0]);
  const [account, setAccount] = useState(demoCase?.input.payeeAccount ?? "");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // SPEC 6-0: 계좌 선택이 끝난 시점에 1단계 8개 툴을 백그라운드로 미리 실행한다.
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    setLoading(true);
    setQuote(null);
    setError(null);
    client
      .quote({
        customer_id: customerId,
        payee_account: account,
        amount,
        current_time: new Date().toISOString(),
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
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, bank]);

  return (
    <>
      <AppBar title="수취계좌" onBack={onBack} />
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
        onChange={(e) => setAccount(e.target.value)}
        placeholder="계좌번호 입력"
        disabled={!!demoCase}
      />

      {account && (
        <div className="card">
          {loading && <span>예금주 조회 중...</span>}
          {!loading && error && <span style={{ color: "var(--danger)" }}>{error}</span>}
          {!loading && !error && quote && (
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
        disabled={!quote || loading}
        onClick={() => quote && onNext(quote, quote.session_id)}
      >
        송금
      </button>
    </>
  );
}
