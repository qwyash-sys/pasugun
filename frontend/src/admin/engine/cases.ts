// 모니터링 사례의 처리 흐름(상태 전이). 화면은 지금 상태에서 가능한 조치(availableActions)만 버튼으로 보여주고,
// 조치를 하면 새 사례 문서(applyAction)를 만들어 저장한다 — 서버·데모 모두 같은 함수를 쓴다.
//
//  내방(visit)     면담 대기 → [담당직원 면담 결과 작성] → 면담 결과 확인 대기 → [본부 확인] → 종결
//  지연송금(delayed) 본부 검토 대기 → [송금 승인 | 고객 재확인 요청 | 지급정지]
//                   고객 재확인 중 → [재확인 결과] → 재확인 완료 → [승인 | 지급정지]
//                   승인 → 사후확인 대기 → [AI 재분석] → 사후확인 결과 확인 대기 → [확인] → 종결
//  선택 대기(pending) → [고객 안내 연락 완료] → 종결
import { kstIso } from "../format";
import type { ActivityEvent, Analysis, Branch, CaseChoice, CaseDoc, Interview, Outcome, Person, ReportPayload, Severity } from "../api/types";

export const CURRENT_STAFF: Person = { name: "구하늘", title: "본부 모니터링 담당" };

export const CHOICE_LABEL: Record<CaseDoc["choice"], string> = {
  visit: "영업점 내방 예약",
  delayed: "지연송금(강행)",
  abandoned: "송금 중단",
  pending: "선택 대기",
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  fraud_confirmed: "보이스피싱 확정",
  normal: "정상 거래",
  unresolved: "미확정",
};

export const INTERVIEW_RESULT_LABEL: Record<Interview["result"], string> = {
  fraud_signs: "보이스피싱 정황 확인",
  normal: "정상 거래 확인",
  no_show: "고객 미내방",
};

export const INTERVIEW_ACTION_LABEL: Record<Interview["action"], string> = {
  payment_stop: "지급정지 요청",
  guide: "고객 안내",
  none: "조치 없음",
};

export type ActionId =
  | "submit_interview"
  | "resend_mail"
  | "confirm_visit"
  | "request_reinterview"
  | "approve"
  | "reconfirm"
  | "hold"
  | "reconfirm_result"
  | "run_postcheck"
  | "confirm_postcheck"
  | "contact_customer";

export interface CaseAction {
  id: ActionId;
  label: string;
  tone: "primary" | "danger" | "default";
  hint: string;
  /** true면 입력(메모·결과 선택)이 필요한 조치 — 화면이 입력창을 띄운다. */
  needsInput?: boolean;
  /** 담당직원 몫이라 시연을 위해 본부 화면에서 대신 입력하는 조치. */
  demoOnBehalf?: boolean;
}

export const isOpen = (c: CaseDoc): boolean => c.status !== "종결";

export function availableActions(c: CaseDoc): CaseAction[] {
  if (!isOpen(c)) return [];
  switch (c.status) {
    case "고객 선택 대기":
      return [{ id: "contact_customer", label: "고객 안내 연락 완료", tone: "default", hint: "고객이 선택을 마치지 않았어요. 연락해 상황을 안내했다면 종결해요." }];
    case "면담 대기":
      return [
        { id: "submit_interview", label: "면담 결과 입력", tone: "primary", hint: "담당 영업점 책임자가 작성하는 항목이에요. 시연을 위해 본부 화면에서 대신 입력해요.", needsInput: true, demoOnBehalf: true },
        { id: "resend_mail", label: "리포트 개인우편 재전송", tone: "default", hint: "담당 책임자에게 리포트를 다시 보내요." },
      ];
    case "면담 결과 확인 대기":
      return [
        { id: "confirm_visit", label: "면담 결과 확인·종결", tone: "primary", hint: "책임자가 작성한 면담 결과를 확인하고 사례를 종결해요.", needsInput: true },
        { id: "request_reinterview", label: "재면담 요청", tone: "default", hint: "결과가 미흡하면 책임자에게 다시 면담하도록 요청해요.", needsInput: true },
      ];
    case "본부 검토 대기":
    case "재확인 완료":
      return [
        { id: "approve", label: "송금 진행 승인", tone: "primary", hint: "위험 요소를 검토했고 송금을 진행해도 된다고 판단해요. 승인 뒤에는 사후 확인을 해요.", needsInput: true },
        ...(c.status === "본부 검토 대기" || c.delayed?.reconfirm?.result === "intent_confirmed"
          ? [{ id: "reconfirm" as const, label: "고객 재확인 요청", tone: "default" as const, hint: "송금을 보류한 채 고객에게 의사를 다시 확인해요.", needsInput: true }]
          : []),
        { id: "hold", label: "지급정지 요청", tone: "danger", hint: "사기로 판단해 송금을 막고 지급정지를 요청해요.", needsInput: true },
      ];
    case "고객 재확인 중":
      return [{ id: "reconfirm_result", label: "재확인 결과 입력", tone: "primary", hint: "고객과 통화한 결과예요. 시연을 위해 본부 화면에서 대신 입력해요.", needsInput: true, demoOnBehalf: true }];
    case "사후확인 대기":
    case "사후확인 결과 확인 대기":
      return [
        { id: "run_postcheck", label: c.postcheck?.analysis ? "AI 재분석 다시 실행" : "수취계좌 AI 재분석 실행", tone: c.postcheck?.analysis ? "default" : "primary", hint: "송금된 수취계좌의 이후 거래내역을 AI로 다시 분석해 정상 거래인지 확인해요." },
        ...(c.postcheck?.analysis ? [{ id: "confirm_postcheck" as const, label: "사후 확인 결과 확인·종결", tone: "primary" as const, hint: "AI 분석 결과를 확인하고 최종 결과를 정해 종결해요.", needsInput: true }] : []),
      ];
    default:
      return [];
  }
}

export interface ActionPayload {
  note?: string;
  interview?: { result: Interview["result"]; action: Interview["action"]; memo: string };
  reconfirmResult?: "intent_confirmed" | "victim_aware";
  outcome?: Outcome;
  activity?: ActivityEvent[];
  analysis?: Analysis;
}

function logEvent(c: CaseDoc, at: string, actor: string, kind: string, text: string): void {
  c.timeline = [...c.timeline, { at, actor, kind, text }];
  c.updated_at = at;
}

export function defaultOutcome(c: CaseDoc): Outcome {
  if (c.visit?.interview) return ({ fraud_signs: "fraud_confirmed", normal: "normal", no_show: "unresolved" } as const)[c.visit.interview.result];
  if (c.delayed?.decision?.type === "hold") return "fraud_confirmed";
  if (c.postcheck?.analysis) return c.postcheck.analysis.verdict === "사기 의심" ? "fraud_confirmed" : c.postcheck.analysis.verdict === "정상 가능성 높음" ? "normal" : "unresolved";
  return "unresolved";
}

/** 조치를 적용한 새 사례 문서를 돌려준다(원본은 건드리지 않는다). 가능하지 않은 조치면 예외. */
export function applyAction(src: CaseDoc, action: ActionId, payload: ActionPayload, now: string, staff: Person = CURRENT_STAFF): CaseDoc {
  if (!availableActions(src).some((a) => a.id === action)) throw new Error(`지금 상태("${src.status}")에서는 할 수 없는 조치예요.`);
  const c: CaseDoc = structuredClone(src);
  const who = `본부 담당자(${staff.name})`;
  const note = (payload.note ?? "").trim();
  const withNote = (text: string) => (note ? `${text} — ${note}` : text);

  switch (action) {
    case "contact_customer":
      c.status = "종결";
      c.outcome = "unresolved";
      c.outcome_at = now;
      logEvent(c, now, who, "contact", withNote("고객에게 안내 연락을 했어요. 선택 없이 종결해요."));
      break;
    case "resend_mail":
      if (c.visit) c.visit.mail = { ...c.visit.mail, sent_at: now };
      logEvent(c, now, who, "mail", `${c.visit?.officer.name ?? "담당자"} ${c.visit?.officer.title ?? ""}에게 리포트를 개인우편으로 다시 보냈어요.`);
      break;
    case "submit_interview": {
      const i = payload.interview;
      if (!c.visit || !i) throw new Error("면담 결과를 입력해주세요.");
      c.visit.interview = { written_at: now, result: i.result, action: i.action, memo: i.memo.trim() };
      c.status = "면담 결과 확인 대기";
      logEvent(c, now, `영업점 담당직원(${c.visit.officer.name})`, "interview", `면담 결과 작성 — ${INTERVIEW_RESULT_LABEL[i.result]}(${INTERVIEW_ACTION_LABEL[i.action]})`);
      break;
    }
    case "request_reinterview":
      if (c.visit) c.visit.interview = null;
      c.status = "면담 대기";
      logEvent(c, now, who, "reinterview", withNote("재면담을 요청했어요."));
      break;
    case "confirm_visit": {
      const outcome = payload.outcome ?? defaultOutcome(c);
      if (c.visit) c.visit.hq_confirmed_at = now;
      c.status = "종결";
      c.outcome = outcome;
      c.outcome_at = now;
      logEvent(c, now, who, "confirm", withNote(`면담 결과를 확인했어요. 최종 결과: ${OUTCOME_LABEL[outcome]}`));
      break;
    }
    case "reconfirm":
      if (!c.delayed) throw new Error("지연송금 사례가 아니에요.");
      c.delayed.decision = { type: "reconfirm", at: now, by: staff.name, note };
      c.delayed.reconfirm = { requested_at: now, result: null, at: null, note: "" };
      c.status = "고객 재확인 중";
      c.assignee = c.assignee ?? staff;
      logEvent(c, now, who, "decision", withNote("고객 재확인을 요청했어요."));
      break;
    case "reconfirm_result": {
      if (!c.delayed?.reconfirm || !payload.reconfirmResult) throw new Error("재확인 결과를 선택해주세요.");
      c.delayed.reconfirm = { ...c.delayed.reconfirm, result: payload.reconfirmResult, at: now, note };
      c.status = "재확인 완료";
      logEvent(c, now, "고객", "reconfirm", withNote(payload.reconfirmResult === "victim_aware" ? "고객이 사기 피해 가능성을 인지했어요." : "고객이 본인 의사로 정상 거래임을 확인했어요."));
      break;
    }
    case "hold":
      if (!c.delayed) throw new Error("지연송금 사례가 아니에요.");
      c.delayed.decision = { type: "hold", at: now, by: staff.name, note };
      c.status = "종결";
      c.outcome = "fraud_confirmed";
      c.outcome_at = now;
      c.assignee = c.assignee ?? staff;
      logEvent(c, now, who, "decision", withNote("지급정지를 요청하고 종결했어요."));
      break;
    case "approve":
      if (!c.delayed) throw new Error("지연송금 사례가 아니에요.");
      c.delayed.decision = { type: "approve", at: now, by: staff.name, note };
      c.delayed.executed_at = now;
      c.postcheck = { required: c.severity === "초고위험", activity: [], analysis: null, confirmed_at: null };
      c.status = "사후확인 대기";
      c.assignee = c.assignee ?? staff;
      logEvent(c, now, who, "decision", withNote("송금 진행을 승인했어요."));
      logEvent(c, now, "시스템", "executed", "지연송금이 실행됐어요. 사후 확인 대상으로 등록했어요.");
      break;
    case "run_postcheck": {
      if (!c.postcheck || !payload.analysis) throw new Error("분석 결과가 없어요.");
      c.postcheck = { ...c.postcheck, activity: payload.activity ?? c.postcheck.activity, analysis: payload.analysis };
      c.status = "사후확인 결과 확인 대기";
      logEvent(c, now, "AI파수꾼", "analysis", `수취계좌 거래내역 AI 재분석 — ${payload.analysis.verdict}(${payload.analysis.confidence}%)`);
      break;
    }
    case "confirm_postcheck": {
      const outcome = payload.outcome ?? defaultOutcome(c);
      if (c.postcheck) c.postcheck.confirmed_at = now;
      c.status = "종결";
      c.outcome = outcome;
      c.outcome_at = now;
      logEvent(c, now, who, "confirm", withNote(`사후 확인 결과를 확인했어요. 최종 결과: ${OUTCOME_LABEL[outcome]}`));
      break;
    }
  }
  return c;
}

/** 목록에서 우선순위를 정하는 값: 초고위험 → 처리 대기 중인 것 → 오래된 것 순으로 먼저. */
const HQ_WAITING = ["본부 검토 대기", "재확인 완료", "면담 결과 확인 대기", "사후확인 대기", "사후확인 결과 확인 대기"];

/** 지금 본부 담당자가 움직여야 하는 상태인지(영업점·고객 쪽 답을 기다리는 중이면 false). */
export const needsHq = (c: CaseDoc): boolean => isOpen(c) && HQ_WAITING.includes(c.status);

export function urgency(c: CaseDoc): number {
  if (!isOpen(c)) return 0;
  return (c.severity === "초고위험" ? 10 : 0) + (needsHq(c) ? 2 : 1);
}

export const POSTCHECK_STATUSES = ["사후확인 대기", "사후확인 결과 확인 대기"];

/** 초고위험: 결정적 피싱징후가 있거나 송금위험·AI분석이 모두 '고'. 나머지 위험 판정은 고위험. */
export function severityOf(report: Pick<ReportPayload, "final">): Severity {
  const f = report.final;
  return f.hard_override || (f.account_level === "고" && f.context_level === "고") ? "초고위험" : "고위험";
}

function nextBusinessMorning(from: Date): Date {
  const d = new Date(from.getTime() + 24 * 3600_000);
  while ([0, 6].includes(new Date(d.getTime() + 9 * 3600_000).getUTCDay())) d.setTime(d.getTime() + 24 * 3600_000);
  return d;
}

/** 고객이 위험 결과 화면에서 선택한 순간의 사례 문서(서버의 case_flow.apply_customer_choice와 같은 결과). */
export function createCase(report: Pick<ReportPayload, "report_id" | "final">, choice: CaseChoice, now: Date, branches: Branch[], opts: { branch?: string; reservedAt?: string } = {}): CaseDoc {
  const at = kstIso(now);
  const doc: CaseDoc = {
    case_id: report.report_id,
    report_id: report.report_id,
    created_at: at,
    updated_at: at,
    choice: "pending",
    severity: severityOf(report),
    status: "고객 선택 대기",
    outcome: null,
    outcome_at: null,
    assignee: null,
    visit: null,
    delayed: null,
    postcheck: null,
    timeline: [{ at, actor: "시스템", kind: "created", text: "위험 판정 — 리포트가 생성됐어요." }],
  };
  const log = (actor: string, kind: string, text: string) => doc.timeline.push({ at, actor, kind, text });

  if (choice === "visit") {
    const branch = branches.find((b) => b.name === (opts.branch ?? "양재남지점")) ?? branches[0];
    const reserved = opts.reservedAt ?? kstIso(new Date(nextBusinessMorning(now).setUTCHours(0, 30, 0, 0)));
    doc.choice = "visit";
    doc.visit = {
      branch: branch.name,
      branch_code: branch.code,
      reserved_at: reserved,
      officer: branch.officer,
      mail: { sent_at: at, to: `${branch.officer.name} ${branch.officer.title} (${branch.name})`, subject: `[AI파수꾼] 고객 면담 요청 · ${report.report_id}` },
      interview: null,
      hq_confirmed_at: null,
    };
    doc.assignee = { name: branch.officer.name, title: `${branch.officer.title} · ${branch.name}` };
    doc.status = "면담 대기";
    log("고객", "choice", `영업점 내방을 예약했어요 — ${branch.name}`);
    log("시스템", "mail", `${branch.name} ${branch.officer.name} ${branch.officer.title}에게 리포트를 개인우편으로 전송했어요.`);
  } else if (choice === "delayed") {
    doc.choice = "delayed";
    doc.delayed = { delay_until: kstIso(new Date(now.getTime() + 2 * 3600_000)), decision: null, reconfirm: null, executed_at: null };
    doc.status = "본부 검토 대기";
    log("고객", "choice", "송금을 강행해 지연송금으로 접수했어요.");
  } else if (choice === "abandoned") {
    doc.choice = "abandoned";
    doc.status = "종결";
    doc.outcome_at = at;
    log("고객", "choice", "위험 안내를 보고 송금을 중단했어요. 조치가 필요 없는 건이에요.");
  }
  return doc;
}
