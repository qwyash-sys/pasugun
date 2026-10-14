import { useEffect, useState } from "react";
import AppBar from "../components/AppBar";
import type { CaseItem } from "../admin/api/types";
import { DEMO_CASES } from "../demoData/cases";

const TONE = { 위험: "danger", 주의: "warn", 안전: "safe" } as const;

export const MANUAL_CASE = "manual";

/** 시연 케이스 선택. 데모는 케이스를 그대로 재생하고, 실제(로컬) 모드는 같은 케이스의 입력값을 채운 뒤
 * 실제 엔진·AI가 판정한다 — 두 모드가 같은 화면·같은 흐름으로 시작하게 한다. */
/** 본부가 '고객 재확인'을 요청한 지연이체(고객 앱 알림에 해당). 실서비스는 로그인한 고객 것만 오지만, 시연에서는 전부 보여준다. */
function useReconfirmRequests(enabled: boolean): CaseItem[] {
  const [items, setItems] = useState<CaseItem[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    import("../admin/api")
      .then(({ getAdminApi }) => getAdminApi().listCases())
      .then((list) => alive && setItems(list.filter((i) => i.case.status === "고객 재확인 중")))
      .catch(() => {
        /* 알림을 못 불러와도 시연은 계속 */
      });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return items;
}

export default function CasePicker({
  live,
  onSelect,
  onBack,
  onReconfirm,
}: {
  live: boolean;
  onSelect: (caseId: string) => void;
  onBack: () => void;
  /** 고객 화면일 때만: 본부의 송금 확인 요청을 연다. */
  onReconfirm?: (item: CaseItem) => void;
}) {
  const requests = useReconfirmRequests(!!onReconfirm);
  return (
    <>
      <AppBar title="시연 케이스" onBack={onBack} />
      {onReconfirm && requests.length > 0 && (
        <div className="reconfirm-banner" role="region" aria-label="본부 확인 요청">
          <strong>📩 본부의 송금 확인 요청 {requests.length}건</strong>
          <span>지연이체로 접수된 송금을 직접 원하시는지 확인하고 있어요.</span>
          {requests.slice(0, 3).map((i) => (
            <button key={i.case.case_id} onClick={() => onReconfirm(i)}>
              {i.report.customer_name}님 → {i.report.payee_name} · {i.report.amount.toLocaleString()}원 <b>답하기 ›</b>
            </button>
          ))}
        </div>
      )}
      <h1 className="title">어떤 상황을 보여드릴까요?</h1>
      <p className="subtitle">
        SPEC 5장 시연 케이스 5종 + 주의 케이스 1종이에요. 점수와 판정은 개발 모드 엔진 기준이에요.
        {live && " 값을 바꾸거나 직접 입력해서 해볼 수도 있어요."}
      </p>
      <div className="case-picker-list">
        {DEMO_CASES.map((c) => {
          const verdict = c.final.final;
          return (
            <button key={c.id} className={`case-picker-item tone-${TONE[verdict]}`} onClick={() => onSelect(c.id)}>
              <span className="case-dot" aria-hidden />
              <span className="case-text">
                <span className="case-title">{c.title}</span>
                <span className="case-subtitle">{c.subtitle}</span>
              </span>
              <span className="case-verdict">{verdict}</span>
            </button>
          );
        })}
        {live && (
          <button className="case-picker-item tone-manual" onClick={() => onSelect(MANUAL_CASE)}>
            <span className="case-dot" aria-hidden />
            <span className="case-text">
              <span className="case-title">직접 입력</span>
              <span className="case-subtitle">고객·금액·수취계좌를 직접 넣어 실제 엔진으로 판정해요</span>
            </span>
            <span className="case-verdict">›</span>
          </button>
        )}
      </div>
    </>
  );
}
