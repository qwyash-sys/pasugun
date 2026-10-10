// 완료 화면의 큰 상태 아이콘. 원이 먼저 그려지고 체크(또는 모래시계)가 이어서 그려진다 —
// 이모지 하나 띄우는 것보다 "처리가 끝났다"는 느낌이 분명하다. 움직임 줄이기 설정이면 바로 완성된 모양.
export default function StatusMark({ kind }: { kind: "done" | "pending" | "cancel" }) {
  return (
    <svg className={`status-mark status-mark-${kind}`} viewBox="0 0 72 72" aria-hidden>
      <circle className="status-mark-ring" cx="36" cy="36" r="32" />
      {kind === "done" ? (
        <path className="status-mark-glyph" d="M22 37.5 31.5 47 50 27" />
      ) : kind === "cancel" ? (
        <path className="status-mark-glyph" d="M26 26 46 46M46 26 26 46" />
      ) : (
        <path className="status-mark-glyph" d="M26 20h20M26 52h20M28 20c0 9 16 9 16 16s-16 7-16 16M44 20c0 9-16 9-16 16s16 7 16 16" />
      )}
    </svg>
  );
}
