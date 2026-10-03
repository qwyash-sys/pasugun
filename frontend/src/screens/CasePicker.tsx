import AppBar from "../components/AppBar";
import { DEMO_CASES } from "../demoData/cases";

const TONE = { 위험: "danger", 주의: "warn", 안전: "safe" } as const;

export default function CasePicker({ onSelect, onBack }: { onSelect: (caseId: string) => void; onBack: () => void }) {
  return (
    <>
      <AppBar title="시연 케이스" onBack={onBack} />
      <h1 className="title">어떤 상황을 보여드릴까요?</h1>
      <p className="subtitle">SPEC 5장 검산 완료 케이스 5종 + 주의 케이스 1종을 그대로 재생해요.</p>
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
      </div>
    </>
  );
}
