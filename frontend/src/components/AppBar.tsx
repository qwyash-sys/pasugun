// 실제 올원뱅크 상단바(뒤로가기 + 가운데 제목 + 홈/메뉴 아이콘)를 따라한다.
// 일반 은행 화면(M1~M3)은 로고 없이 이 바만 쓰고, AI가 개입하는 화면(M4~M6)에서만
// 별도로 <AiTag />를 붙여 "여기서부터는 AI가 살펴보고 있다"는 걸 옅게 표시한다.
interface Props {
  title: string;
  onBack?: () => void;
}

export default function AppBar({ title, onBack }: Props) {
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
        <span>⌂</span>
      </span>
    </div>
  );
}

export function AiTag() {
  return <div className="ai-tag">AI 안전 확인</div>;
}
