import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  text: string;
  onDone?: () => void;
}

/** 이미 완성된 텍스트를 클로드 채팅창처럼 한 글자씩 흘려보낸다. 실제 토큰 스트리밍이
 * 아니라 연출이다 — 데모는 대본이라 애초에 스트리밍할 원본이 없고, 실채팅도 백엔드가
 * 한 번에 완성된 답을 돌려주므로(멀티턴 tool-use 루프를 SSE로 바꾸는 건 배보다 배꼽이
 * 크다), 두 모드를 똑같은 느낌으로 보이게 하려면 프론트에서 재생 속도만 맞추는 편이
 * 실속 있다. surrogate pair(이모지 등)가 반으로 잘리지 않도록 코드포인트 단위로 센다. */
export default function StreamingText({ text, onDone }: Props) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chars = useMemo(() => Array.from(text), []);
  const [count, setCount] = useState(0);
  const spanRef = useRef<HTMLSpanElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (chars.length === 0) {
      onDoneRef.current?.();
      return;
    }
    // 대략 700ms~1.6초 안에 끝나도록: 글자 수가 많을수록 한 틱에 더 많이 내보낸다.
    const step = Math.max(1, Math.round(chars.length / 45));
    let i = 0;
    const id = setInterval(() => {
      i = Math.min(chars.length, i + step);
      setCount(i);
      const screen = spanRef.current?.closest(".screen");
      if (screen) screen.scrollTop = screen.scrollHeight;
      if (i >= chars.length) {
        clearInterval(id);
        onDoneRef.current?.();
      }
    }, 28);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = count >= chars.length;
  return (
    <span ref={spanRef}>
      {chars.slice(0, count).join("")}
      {!done && <span className="stream-cursor" />}
    </span>
  );
}
