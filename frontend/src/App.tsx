import { useMemo, useState } from "react";
import PhoneFrame from "./components/PhoneFrame";
import LoadingOrError from "./components/LoadingOrError";
import { RESPONSE_SOURCE } from "./config";
import { createBackendClient, type BackendClient } from "./api/client";
import { findDemoCase, type DemoCase } from "./demoData/cases";
import CasePicker from "./screens/CasePicker";
import M1Amount from "./screens/M1Amount";
import M2Payee from "./screens/M2Payee";
import M3Confirm from "./screens/M3Confirm";
import M4Question from "./screens/M4Question";
import M5Chat from "./screens/M5Chat";
import M6Result from "./screens/M6Result";
import M7Complete from "./screens/M7Complete";
import ReportView from "./screens/ReportView";
import type { AnswerSubmission, FinalizeResponse, QuoteResponse } from "./types";

type Screen = "case-picker" | "m1" | "m2" | "m3a" | "m4" | "m5" | "m6" | "m7" | "report";

const isDemo = RESPONSE_SOURCE === "demo";

export default function App() {
  const [screen, setScreen] = useState<Screen>(isDemo ? "case-picker" : "m1");
  const [demoCaseId, setDemoCaseId] = useState<string | null>(null);
  const [client, setClient] = useState<BackendClient | null>(isDemo ? null : createBackendClient());
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState(0);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [result, setResult] = useState<FinalizeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<(() => void) | null>(null);

  const demoCase: DemoCase | undefined = useMemo(
    () => (demoCaseId ? findDemoCase(demoCaseId) : undefined),
    [demoCaseId],
  );

  function resetFlow() {
    setDemoCaseId(null);
    setClient(isDemo ? null : createBackendClient());
    setCustomerId("");
    setAmount(0);
    setQuote(null);
    setSessionId(null);
    setResult(null);
    setError(null);
    setRetry(null);
    setScreen(isDemo ? "case-picker" : "m1");
  }

  /** API 호출 1건을 감싸서 busy/error 상태를 일관되게 관리한다.
   * 실패해도 화면은 그대로 두고, "다시 시도" 버튼이 같은 동작을 재실행할 수 있게 기억해둔다. */
  async function runGuarded(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setRetry(null);
    } catch {
      setError("요청 중 문제가 발생했어요. 네트워크 상태를 확인하고 다시 시도해주세요.");
      setRetry(() => () => runGuarded(action));
    } finally {
      setBusy(false);
    }
  }

  function selectDemoCase(caseId: string) {
    setDemoCaseId(caseId);
    setClient(createBackendClient(caseId));
    setScreen("m1");
  }

  function handleM1Next(data: { customerId: string; amount: number }) {
    setCustomerId(data.customerId);
    setAmount(data.amount);
    setScreen("m2");
  }

  function handleM2Next(q: QuoteResponse, sid: string) {
    setQuote(q);
    setSessionId(sid);
    setScreen(q.intervention === "confirm_only" ? "m3a" : "m4");
  }

  function handleConfirmOnly() {
    if (!client || !sessionId) return;
    runGuarded(async () => {
      const res = await client.finalize(sessionId, { skipped: true });
      setResult(res);
      setScreen("m6");
    });
  }

  function handleAnswersDone(answers: AnswerSubmission[]) {
    if (!client || !sessionId) return;
    runGuarded(async () => {
      await client.submitAnswers(sessionId, answers);
      setScreen("m5");
    });
  }

  function handleChatSubmit(payload: { text: string; attachmentBase64: string | null; skipped: boolean }) {
    if (!client || !sessionId) return;
    runGuarded(async () => {
      const res = await client.finalize(sessionId, {
        text: payload.text,
        attachment_base64: payload.attachmentBase64,
        skipped: payload.skipped,
      });
      setResult(res);
      setScreen("m6");
    });
  }

  return (
    <PhoneFrame screenKey={screen}>
      {screen === "case-picker" && <CasePicker onSelect={selectDemoCase} />}

      {screen === "m1" && <M1Amount isDemo={isDemo} demoCase={demoCase} onNext={handleM1Next} />}

      {screen === "m2" && client && (
        <M2Payee
          demoCase={demoCase}
          customerId={customerId}
          amount={amount}
          client={client}
          onBack={() => setScreen("m1")}
          onNext={handleM2Next}
        />
      )}

      {screen === "m3a" && quote && !busy && !error && (
        <M3Confirm
          payeeBank={quote.payee_bank}
          payeeName={quote.payee_name}
          amount={amount}
          onConfirm={handleConfirmOnly}
          onCancel={resetFlow}
        />
      )}
      {screen === "m3a" && (busy || error) && (
        <LoadingOrError busy={busy} error={error} onRetry={retry} onCancel={resetFlow} />
      )}

      {screen === "m4" && quote && !busy && !error && (
        <M4Question
          payeeBank={quote.payee_bank}
          payeeName={quote.payee_name}
          amount={amount}
          questions={quote.questions}
          onDone={handleAnswersDone}
        />
      )}
      {screen === "m4" && (busy || error) && (
        <LoadingOrError busy={busy} error={error} onRetry={retry} onCancel={resetFlow} />
      )}

      {screen === "m5" && (
        <M5Chat hint={demoCase?.chatHint ?? ""} onSubmit={handleChatSubmit} loading={busy} error={error} />
      )}

      {screen === "m6" && result && quote && (
        <M6Result
          final={result.final}
          agentReply={result.agent_reply}
          payeeName={quote.payee_name}
          amount={amount}
          onProceed={() => setScreen("m7")}
          onCancel={resetFlow}
          onViewReport={() => setScreen("report")}
        />
      )}

      {screen === "m7" && result && quote && (
        <M7Complete final={result.final} payeeName={quote.payee_name} amount={amount} onRestart={resetFlow} />
      )}

      {screen === "report" && result?.report && (
        <ReportView report={result.report} onBack={() => setScreen("m6")} onRestart={resetFlow} />
      )}
    </PhoneFrame>
  );
}
