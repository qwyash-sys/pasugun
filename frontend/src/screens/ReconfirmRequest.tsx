// 고객 앱: 본부가 '고객 재확인 요청'을 보낸 지연이체에 고객이 직접 답하는 화면.
// 실서비스에서는 푸시 알림으로 들어오고, 시연에서는 시연 케이스 화면 위 알림에서 들어온다.
import { useState } from "react";
import AppBar from "../components/AppBar";
import StatusMark from "../components/StatusMark";
import type { CaseItem } from "../admin/api/types";

type Answer = "intent_confirmed" | "victim_aware";

const KST = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

export default function ReconfirmRequest({ item, onSubmit, onHome }: { item: CaseItem; onSubmit: (answer: Answer, note: string) => Promise<void>; onHome: () => void }) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const r = item.report;

  if (done) {
    return (
      <>
        <AppBar title="송금 확인 응답" onHome={onHome} />
        <div className="complete-hero done">
          <StatusMark kind="done" />
          <h1 className="complete-title">답변을 보냈어요</h1>
          <p className="complete-to">{r.payee_name}님께 보내는 송금</p>
        </div>
        <p className="complete-note">
          {done === "victim_aware"
            ? "송금은 아직 보내지 않은 상태로 보류돼 있어요. 본부에서 곧 연락드려 지급정지·피해 예방 절차를 안내해 드릴게요."
            : "본부에서 답변을 확인한 뒤 송금 진행 여부를 결정해요. 결과는 알림으로 알려드릴게요."}
        </p>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={onHome}>
          확인
        </button>
      </>
    );
  }

  return (
    <>
      <AppBar title="송금 확인 요청" onHome={onHome} />
      <span className="reconfirm-from">NH농협은행 본부 · 보이스피싱 모니터링</span>
      <h1 className="title">이 송금을 직접 원하시는 게 맞나요?</h1>
      <p className="subtitle">지연이체로 접수된 송금이 보이스피싱 피해가 아닌지 본부에서 한 번 더 확인하고 있어요.</p>

      <dl className="info-list boxed">
        <div>
          <dt>받는 분</dt>
          <dd>
            {r.payee_name} ({r.payee_bank})
          </dd>
        </div>
        <div>
          <dt>금액</dt>
          <dd className="em">{r.amount.toLocaleString()}원</dd>
        </div>
        <div>
          <dt>접수</dt>
          <dd>{KST(r.attempted_at)} · 지연이체</dd>
        </div>
      </dl>

      <div className="reconfirm-choices" role="radiogroup" aria-label="송금 의사">
        <button className={`choice-btn ${answer === "intent_confirmed" ? "selected" : ""}`} role="radio" aria-checked={answer === "intent_confirmed"} onClick={() => setAnswer("intent_confirmed")}>
          제가 직접 원해서 보내는 송금이에요
        </button>
        <button className={`choice-btn ${answer === "victim_aware" ? "selected" : ""}`} role="radio" aria-checked={answer === "victim_aware"} onClick={() => setAnswer("victim_aware")}>
          다시 생각해보니 누군가 시켜서 보내는 것 같아요
        </button>
      </div>

      <textarea className="reconfirm-note" value={note} maxLength={300} placeholder="덧붙일 말이 있으면 적어주세요 (선택)" onChange={(e) => setNote(e.target.value)} />
      {error && <p className="field-error">{error}</p>}

      <div className="spacer" />
      <button
        className="btn btn-primary"
        disabled={!answer || busy}
        onClick={async () => {
          if (!answer) return;
          setBusy(true);
          setError(null);
          try {
            await onSubmit(answer, note.trim());
            setDone(answer);
          } catch {
            setError("답변을 보내지 못했어요. 잠시 후 다시 시도해주세요.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "보내는 중…" : "답변 보내기"}
      </button>
    </>
  );
}
