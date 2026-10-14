// 영업점 책임자 화면. 본부가 보낸 면담 요청(개인우편)을 받아 보고, 고객 면담 뒤 결과를 입력한다.
// 본부 모니터링과 같은 사례 문서를 쓰지만, 이 화면에서는 '책임자 몫'의 조치(면담 결과 입력)만 할 수 있다.
import { useEffect, useMemo, useState } from "react";
import { getAdminApi } from "../api";
import type { Branch, CaseDoc, CaseItem, ReportPayload } from "../api/types";
import { applyAction, availableActions, INTERVIEW_ACTION_LABEL, INTERVIEW_RESULT_LABEL, OUTCOME_LABEL, type ActionPayload, type CaseAction } from "../engine/cases";
import { fmtDateTime, fmtKorean, fmtShort, kstIso, won, wonShort } from "../format";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, useLoad, useToast, type Tone } from "../components/ui";
import ActionModal from "./monitoring/ActionModal";
import { mailBody } from "./monitoring/mail";

const OFFICER_STATUS: Record<string, { label: string; tone: Tone }> = {
  "면담 대기": { label: "면담 결과 입력 필요", tone: "blue" },
  "면담 결과 확인 대기": { label: "본부 확인 중", tone: "warn" },
  종결: { label: "처리 완료", tone: "muted" },
};

const caseFromHash = (): string | null => new URLSearchParams(location.hash.split("?")[1] ?? "").get("case");

export default function BranchPage() {
  const api = getAdminApi();
  const branches = useLoad<Branch[]>(() => api.listBranches(), []);
  const list = useLoad<CaseItem[]>(() => api.listCases(), []);
  const [branchCode, setBranchCode] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(caseFromHash);
  const [detail, setDetail] = useState<{ case: CaseDoc; report: ReportPayload } | null>(null);
  const [acting, setActing] = useState<CaseAction | null>(null);
  const [busy, setBusy] = useState(false);
  const { show, node } = useToast();

  const visits = useMemo(() => (list.data ?? []).filter((i) => i.case.visit), [list.data]);

  // 처음 들어오면: 본부에서 '책임자 화면 열기'로 넘어온 사례의 영업점, 아니면 입력할 건이 가장 많은 영업점.
  const defaultBranch = useMemo(() => {
    const fromCase = visits.find((i) => i.case.case_id === caseFromHash())?.case.visit?.branch_code;
    if (fromCase) return fromCase;
    const pending = new Map<string, number>();
    for (const i of visits) if (i.case.status === "면담 대기") pending.set(i.case.visit!.branch_code, (pending.get(i.case.visit!.branch_code) ?? 0) + 1);
    return [...pending.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? visits[0]?.case.visit?.branch_code ?? "";
  }, [visits]);
  const code = branchCode || defaultBranch;
  const branch = branches.data?.find((b) => b.code === code);

  const inbox = useMemo(
    () =>
      visits
        .filter((i) => i.case.visit?.branch_code === code)
        .sort((a, b) => Number(b.case.status === "면담 대기") - Number(a.case.status === "면담 대기") || b.case.created_at.localeCompare(a.case.created_at)),
    [visits, code],
  );
  const current = selected && inbox.some((i) => i.case.case_id === selected) ? selected : inbox[0]?.case.case_id ?? null;

  useEffect(() => {
    let alive = true;
    if (!current) return;
    api.getCase(current).then(
      (d) => alive && setDetail(d),
      () => alive && setDetail(null),
    );
    return () => {
      alive = false;
    };
  }, [api, current, list.data]);

  const submit = async (payload: ActionPayload) => {
    if (!detail || !acting) return;
    setBusy(true);
    try {
      const officer = detail.case.visit!.officer;
      const next = applyAction(detail.case, acting.id, payload, kstIso(new Date()), officer);
      await api.saveCase(next);
      show("면담 결과를 본부로 보냈어요. 본부가 확인하면 사례가 종결돼요.");
      setActing(null);
      await list.reload(true);
    } catch (e) {
      show(e instanceof Error ? e.message : "보내지 못했어요.", "danger");
    } finally {
      setBusy(false);
    }
  };

  if ((list.loading && !list.data) || (branches.loading && !branches.data)) return <div className="console-content"><Loading /></div>;
  if (list.error || branches.error) return <div className="console-content"><ErrorBox message={list.error ?? branches.error ?? ""} onRetry={() => void list.reload()} /></div>;

  const pendingCount = inbox.filter((i) => i.case.status === "면담 대기").length;
  const doc = detail?.case.case_id === current ? detail.case : null;
  const report = detail?.case.case_id === current ? detail.report : null;
  const action = doc ? availableActions(doc, "officer")[0] : undefined;

  return (
    <div className="console-content c-officer-page">
      <PageHeader
        title="영업점 책임자 화면"
        sub="본부가 보낸 면담 요청(개인우편)을 확인하고, 고객 면담 뒤 결과를 입력해요. 입력한 결과는 본부 모니터링으로 전달돼요."
        actions={
          <label className="c-officer-branch">
            <span>영업점</span>
            <select value={code} onChange={(e) => { setBranchCode(e.target.value); setSelected(null); }} aria-label="영업점 선택">
              {(branches.data ?? []).map((b) => {
                const n = visits.filter((i) => i.case.visit?.branch_code === b.code && i.case.status === "면담 대기").length;
                return (
                  <option key={b.code} value={b.code}>
                    {b.name} · {b.officer.name} {n ? `(입력 필요 ${n})` : ""}
                  </option>
                );
              })}
            </select>
          </label>
        }
      />

      {branch && (
        <div className="c-officer-id">
          <Badge tone="blue">영업점 책임자</Badge>
          <b>
            {branch.name} · {branch.officer.name} {branch.officer.title}
          </b>
          <span className="c-muted c-small">
            {branch.region} · 받은 요청 {inbox.length}건 · 입력 필요 {pendingCount}건
          </span>
        </div>
      )}

      <div className="c-officer-grid">
        <Card title="받은 면담 요청" sub="본부 개인우편으로 온 건이에요.">
          {inbox.length === 0 ? (
            <Empty>이 영업점으로 온 면담 요청이 없어요.</Empty>
          ) : (
            <ul className="c-inbox">
              {inbox.map(({ case: c, report: r }) => {
                const st = OFFICER_STATUS[c.status] ?? OFFICER_STATUS["종결"];
                return (
                  <li key={c.case_id}>
                    <button className={c.case_id === current ? "on" : ""} onClick={() => setSelected(c.case_id)}>
                      <span className="c-inbox-top">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        <span className="c-muted c-small">{fmtShort(c.visit!.mail.sent_at)}</span>
                      </span>
                      <b>
                        {r.customer_name} 고객 · {wonShort(r.amount)}
                      </b>
                      <span className="c-muted c-small">내방 예약 {fmtKorean(c.visit!.reserved_at)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="c-stack">
          {!doc || !report ? (
            <Card>
              <Loading text="요청 내용을 불러오는 중…" />
            </Card>
          ) : (
            <>
              <Card
                className="c-officer-mail"
                title={doc.visit!.mail.subject}
                sub={`${fmtDateTime(doc.visit!.mail.sent_at)} · 보낸 곳: 본부 모니터링 · 받는 사람: ${doc.visit!.mail.to}`}
                actions={
                  action ? (
                    <button className="c-btn c-btn-officer" onClick={() => setActing(action)}>
                      면담 결과 입력
                    </button>
                  ) : undefined
                }
              >
                <pre className="c-mail">{mailBody(doc, report)}</pre>
              </Card>

              <Card title="면담 결과">
                {doc.visit!.interview ? (
                  <dl className="c-kv">
                    <dt>결과</dt>
                    <dd>
                      <b>{INTERVIEW_RESULT_LABEL[doc.visit!.interview.result]}</b> · {INTERVIEW_ACTION_LABEL[doc.visit!.interview.action]}
                    </dd>
                    <dt>작성</dt>
                    <dd>{fmtDateTime(doc.visit!.interview.written_at)}</dd>
                    <dt>내용</dt>
                    <dd>{doc.visit!.interview.memo || "(내용 없음)"}</dd>
                    <dt>본부 확인</dt>
                    <dd>{doc.visit!.hq_confirmed_at ? `${fmtDateTime(doc.visit!.hq_confirmed_at)} 확인 · ${doc.outcome ? OUTCOME_LABEL[doc.outcome] : ""}` : "본부 확인 대기 중"}</dd>
                  </dl>
                ) : (
                  <p className="c-muted">아직 입력하지 않았어요. 고객과 면담한 뒤 ‘면담 결과 입력’을 눌러주세요.</p>
                )}
              </Card>

              <Card title="거래 요약" sub="자세한 판정 근거는 본부 리포트에 있어요.">
                <dl className="c-kv">
                  <dt>고객</dt>
                  <dd>
                    {report.customer_name} · {report.customer_phone_masked}
                  </dd>
                  <dt>수취</dt>
                  <dd>
                    {report.payee_bank} {report.payee_account} · {report.payee_name}
                  </dd>
                  <dt>금액</dt>
                  <dd>{won(report.amount)}</dd>
                  <dt>판정 사유</dt>
                  <dd>{report.final.reasons.join(" · ")}</dd>
                  <dt>상담 요약</dt>
                  <dd>{report.conversation_summary || "-"}</dd>
                </dl>
              </Card>
            </>
          )}
        </div>
      </div>

      {acting && doc && <ActionModal action={acting} doc={doc} busy={busy} actor="officer" onCancel={() => setActing(null)} onSubmit={(p) => void submit(p)} />}
      {node}
    </div>
  );
}
