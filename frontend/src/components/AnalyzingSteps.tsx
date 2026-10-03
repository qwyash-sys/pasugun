import { useEffect, useState } from "react";

// 결과를 기다리는 몇 초 동안 빙글빙글 도는 스피너 하나만 보여주면 멈춘 것처럼 느껴진다.
// 실제로 서버가 하는 일(1단계 → 2단계 → 3단계) 순서대로 단계를 넘겨 보여준다. 응답이 오면
// 화면이 바로 바뀌므로, 단계 표시는 "진행 중"이라는 감각을 주는 용도다(정확한 진행률은 아님).
const STEPS = ["송금위험도 확인", "AI 분석 · 사례집 대조", "최종 판정"];

export default function AnalyzingSteps({ title = "AI가 확인 중이에요" }: { title?: string }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setActive((a) => Math.min(a + 1, STEPS.length - 1)), 600);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="analyzing" role="status" aria-live="polite">
      <div className="analyzing-orb" aria-hidden>
        <span />
      </div>
      <p className="analyzing-title">{title}</p>
      <ol className="analyzing-steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i < active ? "done" : i === active ? "active" : ""}>
            <span className="analyzing-dot" aria-hidden>
              {i < active ? "✓" : i + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>
    </div>
  );
}
