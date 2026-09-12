import type { ReactNode } from "react";

// 실제 올원뱅크의 "한 번 더 확인해 주세요" / "보이스피싱 예방" 모달 패턴:
// 이전 화면을 어둡게 깔고, 흰 시트가 아래에서 올라온다.
export default function BottomSheet({ children }: { children: ReactNode }) {
  return (
    <div className="sheet-backdrop">
      <div className="sheet">
        <div className="sheet-handle" />
        {children}
      </div>
    </div>
  );
}
