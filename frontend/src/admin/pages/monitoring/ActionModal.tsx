// 조치 버튼을 눌렀을 때 필요한 입력(메모·결과 선택)을 받는 창.
import { useState } from "react";
import type { Interview, Outcome } from "../../api/types";
import { defaultOutcome, INTERVIEW_ACTION_LABEL, INTERVIEW_RESULT_LABEL, OUTCOME_LABEL, type ActionPayload, type CaseAction } from "../../engine/cases";
import type { CaseDoc } from "../../api/types";
import { Field, Modal } from "../../components/ui";

const CONFIRM_TEXT: Record<string, string> = {
  hold: "지급정지를 요청하면 이 송금은 막히고 사례가 종결돼요. 되돌릴 수 없어요.",
  approve: "승인하면 지연된 송금이 실행돼요. 승인 뒤에는 수취계좌 사후 확인 단계로 넘어가요.",
  confirm_visit: "확인하면 사례가 종결돼요.",
  confirm_postcheck: "확인하면 사례가 종결돼요.",
};

export default function ActionModal({ action, doc, busy, onCancel, onSubmit }: { action: CaseAction; doc: CaseDoc; busy: boolean; onCancel: () => void; onSubmit: (p: ActionPayload) => void }) {
  const [note, setNote] = useState("");
  const [result, setResult] = useState<Interview["result"]>("normal");
  const [follow, setFollow] = useState<Interview["action"]>("none");
  const [reconfirm, setReconfirm] = useState<"intent_confirmed" | "victim_aware">("intent_confirmed");
  const [outcome, setOutcome] = useState<Outcome>(defaultOutcome(doc));

  const id = action.id;
  const noteRequired = id === "request_reinterview" || id === "hold";
  const memoRequired = id === "submit_interview";
  const missing = (noteRequired || memoRequired) && !note.trim();

  const submit = () => {
    if (id === "submit_interview") onSubmit({ interview: { result, action: follow, memo: note }, note });
    else if (id === "reconfirm_result") onSubmit({ reconfirmResult: reconfirm, note });
    else if (id === "confirm_visit" || id === "confirm_postcheck") onSubmit({ outcome, note });
    else onSubmit({ note });
  };

  return (
    <Modal
      open
      title={action.label}
      onClose={busy ? () => {} : onCancel}
      footer={
        <>
          <button className="c-btn" onClick={onCancel} disabled={busy}>
            취소
          </button>
          <button className={`c-btn ${action.tone === "danger" ? "c-btn-danger" : "c-btn-primary"}`} onClick={submit} disabled={busy || missing}>
            {busy ? "처리 중…" : action.label}
          </button>
        </>
      }
    >
      <p className="c-muted c-small" style={{ margin: 0 }}>
        {action.hint}
      </p>
      {CONFIRM_TEXT[id] && <div className={`c-note ${id === "hold" ? "tone-danger" : "tone-warn"}`}>{CONFIRM_TEXT[id]}</div>}

      {id === "submit_interview" && (
        <>
          <Field label="면담 결과">
            <select value={result} onChange={(e) => setResult(e.target.value as Interview["result"])}>
              {(Object.keys(INTERVIEW_RESULT_LABEL) as Interview["result"][]).map((k) => (
                <option key={k} value={k}>
                  {INTERVIEW_RESULT_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="조치">
            <select value={follow} onChange={(e) => setFollow(e.target.value as Interview["action"])}>
              {(Object.keys(INTERVIEW_ACTION_LABEL) as Interview["action"][]).map((k) => (
                <option key={k} value={k}>
                  {INTERVIEW_ACTION_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      {id === "reconfirm_result" && (
        <Field label="고객 재확인 결과">
          <select value={reconfirm} onChange={(e) => setReconfirm(e.target.value as typeof reconfirm)}>
            <option value="intent_confirmed">본인 의사로 정상 거래임을 확인했어요</option>
            <option value="victim_aware">사기 피해 가능성을 인지했어요</option>
          </select>
        </Field>
      )}

      {(id === "confirm_visit" || id === "confirm_postcheck") && (
        <Field label="최종 결과" hint="면담·AI 분석 결과를 바탕으로 정했어요. 필요하면 바꿀 수 있어요.">
          <select value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)}>
            {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((k) => (
              <option key={k} value={k}>
                {OUTCOME_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label={id === "submit_interview" ? "면담 내용(필수)" : noteRequired ? "사유(필수)" : "메모(선택)"} error={missing && note.length > 0 ? "내용을 입력해주세요." : undefined}>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={id === "submit_interview" ? "고객 면담에서 확인한 내용을 적어주세요." : "처리 이력에 남아요."} />
      </Field>
    </Modal>
  );
}
