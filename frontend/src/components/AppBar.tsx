// 실제 올원뱅크 상단바(뒤로가기 + 가운데 제목 + 홈/메뉴 아이콘)를 따라한다.
// 일반 은행 화면(M1~M3)은 로고 없이 이 바만 쓰고, AI가 개입하는 화면(M4~M6)에서만
// 별도로 <AiTag />를 붙여 "여기서부터는 AI가 살펴보고 있다"는 걸 옅게 표시한다.
interface Props {
  title: string;
  onBack?: () => void;
  /** 우측 상단 홈 아이콘 — 처음 화면으로 돌아간다(demo는 케이스 선택, local/remote는 이체 입력).
   * 안 넘기면 예전처럼 눌러도 반응 없는 장식 아이콘으로 남는다. */
  onHome?: () => void;
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9v10a1 1 0 0 0 1 1H10v-5.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V20h3.5a1 1 0 0 0 1-1V9" />
    </svg>
  );
}

export default function AppBar({ title, onBack, onHome }: Props) {
  return (
    <div className="appbar">
      {onBack ? (
        <button className="appbar-back" onClick={onBack} aria-label="뒤로가기">
          ‹
        </button>
      ) : (
        <span style={{ width: 32 }} />
      )}
      <span className="appbar-title">{title}</span>
      <span className="appbar-icons">
        {onHome ? (
          <button className="appbar-home" onClick={onHome} aria-label="처음으로">
            <HomeIcon />
          </button>
        ) : (
          <HomeIcon />
        )}
      </span>
    </div>
  );
}

export function AiTag() {
  return <div className="ai-tag">AI파수꾼 실시간 분석</div>;
}
