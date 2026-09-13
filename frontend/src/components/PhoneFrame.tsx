import { useEffect, useRef, type ReactNode } from "react";
import { RESPONSE_SOURCE } from "../config";

export default function PhoneFrame({ screenKey, children }: { screenKey: string; children: ReactNode }) {
  const screenRef = useRef<HTMLDivElement>(null);

  // 화면(스크린) 전환 시 스크롤 위치를 위로 되돌린다 — 안 그러면 이전 화면에서
  // 스크롤해 내려간 위치가 다음 화면에도 그대로 남아 상단바/제목이 잘려 보인다.
  useEffect(() => {
    screenRef.current?.scrollTo(0, 0);
  }, [screenKey]);

  return (
    <>
      <div className="mode-pill">{RESPONSE_SOURCE.toUpperCase()} 모드</div>
      <div className="phone">
        <div className="phone-statusbar" />
        <div className="screen" ref={screenRef}>
          {children}
        </div>
      </div>
    </>
  );
}
