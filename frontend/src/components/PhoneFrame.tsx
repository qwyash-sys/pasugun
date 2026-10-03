import { useEffect, useRef, useState, type ReactNode } from "react";
import { RESPONSE_SOURCE } from "../config";
import { ROLE_LABEL, type Role } from "../roles";

interface Props {
  screenKey: string;
  /** 흐름상 화면 순서 — 이전보다 크면 앞으로(오른쪽에서 진입), 작으면 뒤로(왼쪽에서 진입). */
  screenIndex: number;
  role: Role | null;
  onChangeRole: () => void;
  children: ReactNode;
}

export default function PhoneFrame({ screenKey, screenIndex, role, onChangeRole, children }: Props) {
  const screenRef = useRef<HTMLDivElement>(null);
  // 이전 렌더의 화면 순서를 기억해 방향을 정한다(React 권장 "렌더 중 이전 값 비교" 패턴).
  const [prevIndex, setPrevIndex] = useState(screenIndex);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  if (screenIndex !== prevIndex) {
    setDirection(screenIndex > prevIndex ? "forward" : "back");
    setPrevIndex(screenIndex);
  }

  // 화면(스크린) 전환 시 스크롤 위치를 위로 되돌린다 — 안 그러면 이전 화면에서
  // 스크롤해 내려간 위치가 다음 화면에도 그대로 남아 상단바/제목이 잘려 보인다.
  useEffect(() => {
    screenRef.current?.scrollTo(0, 0);
  }, [screenKey]);

  const mode = `${RESPONSE_SOURCE.toUpperCase()} 모드`;
  return (
    <>
      {role ? (
        <button className="mode-pill" onClick={onChangeRole} title="역할 다시 선택">
          {mode} · {ROLE_LABEL[role]} ⇄
        </button>
      ) : (
        <div className="mode-pill">{mode}</div>
      )}
      <div className="phone">
        <div className="phone-statusbar" />
        <div className="screen" ref={screenRef} data-dir={direction}>
          {children}
        </div>
      </div>
    </>
  );
}
