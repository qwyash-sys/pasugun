// 사례 상세: 지금 해야 할 조치 → 고객 선택 분기별 진행 내용 → 위험 리포트 → 처리 이력.
import { useState } from "react";
import type { ActivityEvent, Analysis, CaseDoc, ReportPayload } from "../../api/types";
import { availableActions, CHOICE_LABEL, INTERVIEW_ACTION_LABEL, INTERVIEW_RESULT_LABEL, OUTCOME_LABEL, type ActionPayload, type CaseAction } from "../../engine/cases";
import { fmtDateTime, fmtKorean, fmtShort, won } from "../../format";
import { Badge, Card, Drawer, ErrorBox, Loading, useLoad } from "../../components/ui";
import { getAdminApi } from "../../api";
import ActionModal from "./ActionModal";
import ReportSection from "./ReportSection";
import { ACTIVITY_ICON, CHOICE_TONE, statusTone, WAITING_ON } from "./labels";

function mailBody(doc: CaseDoc, report: ReportPayload): string {
  const v = doc.visit!;
  return [
    `${v.officer.name} ${v.officer.title}님께,`,
    "",
    `AI파수꾼이 아래 거래를 고위험으로 분류했고, 고객이 영업점 내방을 예약했습니다. 면담 후 결과를 입력해 주세요.`,
    "",
    `· 고객: ${report.customer_name} (${report.customer_phone_masked})`,
    `· 예약: ${v.branch} ${fmtKorean(v.reserved_at)}`,
    `· 거래: ${report.payee_bank} ${report.payee_name} ${won(report.amount)}`,
    `· 판정: ${report.final.final}(송금위험도 ${report.final.account_level} · AI분석 ${report.final.context_level})`,
    `· 권고: ${report.recommendation}`,
    "",
    "※ 본 메일은 개인우편으로 담당 책임자에게만 전달됩니다.",
  ].join("\n");
}

function ActivityList({ items }: { items: ActivityEvent[] }) {
  return (
    <ul className="c-activity">
      {items.map((e, i) => (
        <li key={i} className={e.kind}>
          <span aria-hidden>{ACTIVITY_ICON[e.kind] ?? "•"}</span>
          <div>
            <b>{e.text}</b>
            <small>{fmtShort(e.at)}</small>
          </div>
        </li>
      ))}
    </ul>
  );
}

function AnalysisCard({ a }: { a: Analysis }) {
  const tone = a.verdict === "사기 의심" ? "danger" : a.verdict === "추가 확인 필요" ? "warn" : "green";
  return (
    <div className={`c-analysis tone-${tone}`}>
      <div className="c-analysis-head">
        <strong>{a.verdict}</strong>
        <span>신뢰도 {a.confidence}%</span>
        <Badge tone={a.source === "ai" ? "purple" : "muted"}>{a.source === "ai" ? "AI 설명" : a.source === "seed" ? "샘플" : "규칙 기반"}</Badge>
      </div>
      <p>{a.narrative}</p>
      <ul>
        {a.evidence.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
      <p className="c-analysis-action">
        <b>권고 조치</b> {a.action}
      </p>
    </div>
  );
}

export default function CaseDrawer({
  caseId,
  rev,
  onClose,
  onAct,
  position,
  onMove,
}: {
  caseId: string;
  rev: number;
  /** 지금 목록(필터 적용)에서 이 사례의 위치 — 이전/다음 사례로 바로 넘어갈 때 쓴다. */
  position?: { index: number; total: number };
  onMove?: (delta: -1 | 1) => void;
  onClose: () => void;
  onAct: (doc: CaseDoc, action: CaseAction["id"], payload: ActionPayload) => Promise<void>;
}) {
  const detail = useLoad(() => getAdminApi().getCase(caseId), [caseId, rev]);
  const [pending, setPending] = useState<CaseAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);

  const doc = detail.data?.case;
  const report = detail.data?.report;
  const actions = doc ? availableActions(doc) : [];

  const run = async (action: CaseAction, payload: ActionPayload) => {
    if (!doc) return;
    setBusy(true);
    try {
      await onAct(doc, action.id, payload);
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  const click = (a: CaseAction) => {
    if (a.needsInput) setPending(a);
    else void run(a, {});
  };

  return (
    <Drawer
      open
      wide
      title={
        <>
          {caseId} {doc && <Badge tone={doc.severity === "초고위험" ? "danger" : "warn"}>{doc.severity}</Badge>}
        </>
      }
      sub={doc && report ? `${report.customer_name} → ${report.payee_name} · ${won(report.amount)}` : undefined}
      onClose={onClose}
      footer={
        position && onMove ? (
          <div className="c-pager">
            <button className="c-btn c-btn-sm" onClick={() => onMove(-1)} disabled={position.index <= 0}>
              ‹ 이전 사례
            </button>
            <span className="c-muted c-small">
              목록의 {position.index + 1} / {position.total}
            </span>
            <button className="c-btn c-btn-sm" onClick={() => onMove(1)} disabled={position.index >= position.total - 1}>
              다음 사례 ›
            </button>
          </div>
        ) : undefined
      }
    >
      {detail.loading && !doc && <Loading />}
      {detail.error && <ErrorBox message={detail.error} onRetry={() => void detail.reload()} />}
      {doc && report && (
        <div className="c-stack">
          <Card className="c-next" title="지금 상태">
            <div className="c-status-line">
              <Badge tone={statusTone(doc)}>{doc.status}</Badge>
              <Badge tone={CHOICE_TONE[doc.choice]}>{CHOICE_LABEL[doc.choice]}</Badge>
              <span className="c-muted c-small">{WAITING_ON[doc.status] ?? ""}</span>
            </div>
            {doc.outcome && (
              <p className="c-small" style={{ margin: "8px 0 0" }}>
                최종 결과: <b>{OUTCOME_LABEL[doc.outcome]}</b>
              </p>
            )}
            {actions.length > 0 && (
              <ul className="c-actions">
                {actions.map((a) => (
                  <li key={a.id}>
                    <button className={`c-btn ${a.tone === "primary" ? "c-btn-primary" : a.tone === "danger" ? "c-btn-danger" : ""}`} onClick={() => click(a)} disabled={busy}>
                      {busy && !a.needsInput ? "처리 중…" : a.label}
                    </button>
                    <span className="c-muted c-small">
                      {a.hint}
                      {a.demoOnBehalf && " (시연용)"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {doc.visit && (
            <Card title="① 영업점 내방 예약" sub="리포트는 해당 영업점 담당 준법감시책임자에게 개인우편으로 전달돼요.">
              <dl className="c-kv">
                <dt>영업점</dt>
                <dd>
                  {doc.visit.branch} ({doc.visit.branch_code})
                </dd>
                <dt>예약 일시</dt>
                <dd>{fmtKorean(doc.visit.reserved_at)}</dd>
                <dt>담당 책임자</dt>
                <dd>
                  {doc.visit.officer.name} {doc.visit.officer.title} <span className="c-muted c-small">(영업점 자동 배정)</span>
                </dd>
                <dt>개인우편</dt>
                <dd>
                  {fmtDateTime(doc.visit.mail.sent_at)} 전송 · {doc.visit.mail.to}
                  <br />
                  <span className="c-muted c-small">{doc.visit.mail.subject}</span>{" "}
                  <button className="c-btn c-btn-sm" onClick={() => setMailOpen((v) => !v)}>
                    {mailOpen ? "본문 닫기" : "본문 보기"}
                  </button>
                  {mailOpen && <pre className="c-mail">{mailBody(doc, report)}</pre>}
                </dd>
                <dt>면담 결과</dt>
                <dd>
                  {doc.visit.interview ? (
                    <>
                      <b>{INTERVIEW_RESULT_LABEL[doc.visit.interview.result]}</b> · {INTERVIEW_ACTION_LABEL[doc.visit.interview.action]} <span className="c-muted c-small">({fmtShort(doc.visit.interview.written_at)} 작성)</span>
                      <p className="c-text-block">{doc.visit.interview.memo || "(내용 없음)"}</p>
                    </>
                  ) : (
                    <span className="c-muted">책임자가 아직 작성하지 않았어요.</span>
                  )}
                </dd>
                <dt>본부 확인</dt>
                <dd>{doc.visit.hq_confirmed_at ? `${fmtDateTime(doc.visit.hq_confirmed_at)} 확인 완료` : <span className="c-muted">확인 전</span>}</dd>
              </dl>
            </Card>
          )}

          {doc.delayed && (
            <Card title="② 지연송금(고객이 송금 강행)" sub="본부가 리포트와 거래 추적으로 판단해 송금을 진행하거나 고객에게 다시 확인해요.">
              <dl className="c-kv">
                <dt>지연 해제 예정</dt>
                <dd>{fmtDateTime(doc.delayed.delay_until)}</dd>
                <dt>본부 결정</dt>
                <dd>
                  {doc.delayed.decision ? (
                    <>
                      <b>{{ approve: "송금 진행 승인", reconfirm: "고객 재확인 요청", hold: "지급정지 요청" }[doc.delayed.decision.type]}</b> · {doc.delayed.decision.by} ({fmtShort(doc.delayed.decision.at)})
                      {doc.delayed.decision.note && <p className="c-text-block">{doc.delayed.decision.note}</p>}
                    </>
                  ) : (
                    <span className="c-muted">아직 결정 전이에요.</span>
                  )}
                </dd>
                {doc.delayed.reconfirm && (
                  <>
                    <dt>고객 재확인</dt>
                    <dd>
                      {doc.delayed.reconfirm.result ? (
                        <>
                          <b>{doc.delayed.reconfirm.result === "intent_confirmed" ? "본인 의사로 정상 거래 확인" : "사기 피해 가능성 인지"}</b>
                          {doc.delayed.reconfirm.note && <p className="c-text-block">{doc.delayed.reconfirm.note}</p>}
                        </>
                      ) : (
                        <span className="c-muted">{fmtShort(doc.delayed.reconfirm.requested_at)} 요청 · 응답 대기</span>
                      )}
                    </dd>
                  </>
                )}
                <dt>송금 실행</dt>
                <dd>{doc.delayed.executed_at ? `${fmtDateTime(doc.delayed.executed_at)} 실행됨` : <span className="c-muted">실행 전(보류 중)</span>}</dd>
              </dl>
            </Card>
          )}

          {doc.postcheck && (
            <Card title="③ 사후 확인" sub={doc.postcheck.required ? "초고위험 건은 송금 실행 뒤 수취계좌의 이후 거래내역을 AI로 다시 분석해 정상 거래였는지 확인해요." : "고위험 건의 선택 확인이에요. 필요하면 수취계좌 거래내역을 재분석할 수 있어요."}>
              {doc.postcheck.activity.length > 0 ? (
                <>
                  <h4 className="c-sec">수취계좌 이후 거래내역</h4>
                  <ActivityList items={doc.postcheck.activity} />
                  <p className="c-muted c-small" style={{ margin: "8px 0 0" }}>
                    ※ 프로토타입이라 수취계좌 거래내역은 가상으로 만든 예시예요. 실제 서비스에서는 수취은행 연계로 받아와요.
                  </p>
                </>
              ) : (
                <p className="c-muted">아직 분석하지 않았어요. ‘수취계좌 AI 재분석 실행’을 눌러주세요.</p>
              )}
              {doc.postcheck.analysis && (
                <>
                  <h4 className="c-sec" style={{ marginTop: 14 }}>
                    AI 재분석 결과 <span className="c-muted c-small">({fmtShort(doc.postcheck.analysis.at)})</span>
                  </h4>
                  <AnalysisCard a={doc.postcheck.analysis} />
                </>
              )}
              {doc.postcheck.confirmed_at && <p className="c-small c-muted">본부 확인: {fmtDateTime(doc.postcheck.confirmed_at)}</p>}
            </Card>
          )}

          {doc.choice === "abandoned" && <div className="c-note tone-muted">고객이 위험 안내를 보고 송금을 중단했어요. 추가 조치가 필요 없어요.</div>}
          {doc.choice === "pending" && <div className="c-note tone-warn">고객이 아직 선택을 하지 않았어요(앱을 닫았거나 응답 전). 선택이 들어오면 자동으로 이어져요.</div>}

          <Card title="위험 리포트">
            <ReportSection report={report} />
          </Card>

          <Card title="처리 이력">
            <ol className="c-timeline">
              {[...doc.timeline].reverse().map((t, i) => (
                <li key={i}>
                  <span className="c-tl-time">{fmtShort(t.at)}</span>
                  <div>
                    <b>{t.actor}</b>
                    <p>{t.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}

      {pending && doc && <ActionModal action={pending} doc={doc} busy={busy} onCancel={() => setPending(null)} onSubmit={(p) => void run(pending, p)} />}
    </Drawer>
  );
}
