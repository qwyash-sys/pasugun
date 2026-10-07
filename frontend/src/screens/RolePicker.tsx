import type { Role } from "../roles";

function ShieldLogo() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden>
      <path className="logo-shield" d="M32 5 54 13v16c0 15-9.5 25.5-22 30C19.5 54.5 10 44 10 29V13z" />
      <path className="logo-check" d="M22 32.5 29 39.5 43 25" />
    </svg>
  );
}

// 같은 이체 흐름을 누가 보느냐에 따라 화면이 달라진다.
//  - 고객: 결과와 다음 행동만(탐지 로직 노출 금지).
//  - 관리자 뷰: 같은 고객 화면의 뒷단 — 1·2·3단계 판단 근거, 영업점 리포트·첨부자료.
//  - 관리자 페이지: 본부 담당자의 PC 콘솔 — 룰 관리, 모니터링, 통계 분석.
export default function RolePicker({ onSelect }: { onSelect: (role: Role) => void }) {
  return (
    <div className="role-picker">
      <div className="role-hero">
        <div className="role-logo">
          <ShieldLogo />
        </div>
        <h1 className="role-brand">AI파수꾼</h1>
        <p className="role-tagline">송금 직전, AI가 보이스피싱 정황을 한 번 더 확인해요</p>
      </div>

      <p className="role-question">누구로 시작할까요?</p>
      <div className="role-list">
        <button className="role-card" onClick={() => onSelect("customer")}>
          <span className="role-icon role-icon-customer" aria-hidden>
            👤
          </span>
          <span className="role-text">
            <strong>고객 (사용자)</strong>
            <span>송금하는 고객 화면 — 분석 결과와 다음 행동만 간단히 안내해요</span>
          </span>
          <span className="role-chevron" aria-hidden>
            ›
          </span>
        </button>
        <button className="role-card" onClick={() => onSelect("admin")}>
          <span className="role-icon role-icon-admin" aria-hidden>
            🔎
          </span>
          <span className="role-text">
            <strong>고객(사용자) – 관리자 뷰</strong>
            <span>같은 송금 흐름의 뒷단 — 1·2·3단계 판단 근거, 영업점 리포트·첨부자료</span>
          </span>
          <span className="role-chevron" aria-hidden>
            ›
          </span>
        </button>

        <div className="role-divider">
          <span>본부 · PC 화면</span>
        </div>

        <button className="role-card role-card-staff" onClick={() => onSelect("staff")}>
          <span className="role-icon role-icon-staff" aria-hidden>
            🏦
          </span>
          <span className="role-text">
            <strong>내부직원 (관리자 페이지)</strong>
            <span>룰 관리 · 고위험 거래 모니터링 · 통계 분석 — PC 화면 기준으로 설계됐어요</span>
          </span>
          <span className="role-chevron" aria-hidden>
            ›
          </span>
        </button>
      </div>

      <p className="role-footnote">같은 송금 흐름이지만 보는 사람에 따라 화면이 달라져요</p>
    </div>
  );
}
