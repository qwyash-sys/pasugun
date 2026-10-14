import type { ReactNode } from "react";
import { createPortal } from "react-dom";

// 실제 올원뱅크의 "한 번 더 확인해 주세요" / "보이스피싱 예방" 모달 패턴:
// 이전 화면을 어둡게 깔고, 흰 시트가 아래에서 올라온다.
// 항상 폰 화면(.phone) 전체를 기준으로 띄운다 — 화면 하단 고정 영역(sticky) 안에서 그리면 그 영역 크기에
// 갇혀 시트의 버튼이 잘려 보이던 문제가 있었다(채팅 화면 'AI분석 건너뛰기' 확인창).
export default function BottomSheet({ children }: { children: ReactNode }) {
  const sheet = (
    <div className="sheet-backdrop">
      <div className="sheet">
        <div className="sheet-handle" />
        {children}
      </div>
    </div>
  );
  const host = typeof document !== "undefined" ? document.querySelector(".phone") : null;
  return host ? createPortal(sheet, host) : sheet;
}
