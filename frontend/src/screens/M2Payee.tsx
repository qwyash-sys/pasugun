import { useEffect, useState } from "react";
import TopBar from "../components/TopBar";
import type { BackendClient } from "../api/client";
import type { DemoCase } from "../demoData/cases";
import type { QuoteResponse } from "../types";

interface Props {
  demoCase?: DemoCase;
  customerId: string;
  amount: number;
  client: BackendClient;
  onNext: (quote: QuoteResponse, sessionId: string) => void;
}

export default function M2Payee({ demoCase, customerId, amount, client, onNext }: Props) {
  const [bank, setBank] = useState(demoCase?.input.payeeBank ?? "");
  const [account, setAccount] = useState(demoCase?.input.payeeAccount ?? "");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // SPEC 6-0: 계좌 선택이 끝난 시점에 1단계 8개 툴을 백그라운드로 미리 실행한다.
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    setLoading(true);
    setQuote(null);
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
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  return (
    <>
      <TopBar />
      <h1 className="title">수취 계좌 선택</h1>
      <p className="subtitle">{amount.toLocaleString()}원을 보낼 계좌를 알려주세요.</p>

      <div className="field-label">은행</div>
      <input type="text" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="예: 신한은행" />

      <div className="field-label">계좌번호</div>
      <input
        type="text"
        value={account}
        onChange={(e) => setAccount(e.target.value)}
        placeholder="계좌번호 입력"
      />

      {account && (
        <div className="card">
          {loading && <span>예금주 조회 중...</span>}
          {!loading && quote && (
            <span>
              예금주 <strong>{quote.payee_name}</strong> ({quote.payee_bank || bank})
            </span>
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
