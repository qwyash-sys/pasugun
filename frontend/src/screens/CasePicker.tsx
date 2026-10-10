import AppBar from "../components/AppBar";
import { DEMO_CASES } from "../demoData/cases";

const TONE = { 위험: "danger", 주의: "warn", 안전: "safe" } as const;

export const MANUAL_CASE = "manual";

/** 시연 케이스 선택. 데모는 케이스를 그대로 재생하고, 실제(로컬) 모드는 같은 케이스의 입력값을 채운 뒤
 * 실제 엔진·AI가 판정한다 — 두 모드가 같은 화면·같은 흐름으로 시작하게 한다. */
export default function CasePicker({ live, onSelect, onBack }: { live: boolean; onSelect: (caseId: string) => void; onBack: () => void }) {
  return (
    <>
      <AppBar title="시연 케이스" onBack={onBack} />
      <h1 className="title">어떤 상황을 보여드릴까요?</h1>
      <p className="subtitle">
        {live
          ? "케이스를 고르면 입력값이 채워지고, 실제 엔진과 AI가 판정해요. 값을 바꾸거나 직접 입력해도 돼요."
          : "SPEC 5장 검산 완료 케이스 5종 + 주의 케이스 1종을 그대로 재생해요."}
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
              <span className="case-verdict">{live ? `예상 ${verdict}` : verdict}</span>
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
