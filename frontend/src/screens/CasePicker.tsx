import TopBar from "../components/TopBar";
import { DEMO_CASES } from "../demoData/cases";

export default function CasePicker({ onSelect }: { onSelect: (caseId: string) => void }) {
  return (
    <>
      <TopBar />
      <h1 className="title">시연 케이스 선택</h1>
      <p className="subtitle">SPEC 5장 검산 완료 케이스 5종을 그대로 재생합니다.</p>
      <div className="case-picker-list">
        {DEMO_CASES.map((c) => (
          <button key={c.id} className="case-picker-item" onClick={() => onSelect(c.id)}>
            <span className="case-emoji">{c.emoji}</span>
            <span>
              <div className="case-title">{c.title}</div>
              <div className="case-subtitle">{c.subtitle}</div>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
