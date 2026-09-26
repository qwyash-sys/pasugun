import type { Role } from "../roles";

// 같은 이체 흐름을 누가 보느냐에 따라 결과 화면이 달라진다 — 고객에게는 1·2·3단계 판단
// 근거와 영업점 리포트를 보여주면 안 되고(탐지 로직 노출), 내부직원에게는 그게 핵심 정보다.
export default function RolePicker({ onSelect }: { onSelect: (role: Role) => void }) {
  return (
    <>
      <div className="ai-tag">AI파수꾼</div>
      <h1 className="title">누구로 시작할까요?</h1>
      <p className="subtitle">같은 송금 흐름이지만 보는 사람에 따라 결과 화면이 달라져요.</p>

      <div className="case-picker-list">
        <button className="case-picker-item role-item" onClick={() => onSelect("customer")}>
          <span className="case-emoji">👤</span>
          <span>
            <div className="case-title">고객 (사용자)</div>
            <div className="case-subtitle">송금하는 고객이 보는 화면 — AI 분석 결과와 다음 행동만 간단히 안내해요.</div>
          </span>
        </button>
        <button className="case-picker-item role-item" onClick={() => onSelect("admin")}>
          <span className="case-emoji">🏦</span>
          <span>
            <div className="case-title">내부직원 (관리자)</div>
            <div className="case-subtitle">
              1·2·3단계 판단 근거, 영업점 리포트·첨부자료, 리포트 목록까지 확인해요.
            </div>
          </span>
        </button>
      </div>
    </>
  );
}
