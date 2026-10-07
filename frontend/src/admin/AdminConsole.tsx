import "./console.css";
import { useEffect, useState } from "react";
import { RESPONSE_SOURCE } from "../config";
import MonitoringPage from "./pages/MonitoringPage";
import RulesPage from "./pages/RulesPage";
import StatsPage from "./pages/StatsPage";

export type ConsolePage = "rules" | "monitoring" | "stats";

const NAV: { id: ConsolePage; icon: string; label: string; hint: string }[] = [
  { id: "rules", icon: "⚙️", label: "룰 관리", hint: "룰·임계치 조정, AI 룰 분석" },
  { id: "monitoring", icon: "🛰️", label: "모니터링", hint: "고위험 거래 조치" },
  { id: "stats", icon: "📊", label: "통계 분석", hint: "로그 분석·개선 제안" },
];

const HASH_PREFIX = "#/admin/";
const DEFAULT_PAGE: ConsolePage = "monitoring";

function pageFromHash(): ConsolePage {
  const id = location.hash.startsWith(HASH_PREFIX) ? location.hash.slice(HASH_PREFIX.length).split("/")[0] : "";
  return NAV.some((n) => n.id === id) ? (id as ConsolePage) : DEFAULT_PAGE;
}

/** 본부 담당자용 관리자 페이지. PC 화면을 기준으로 설계하고(좌측 메뉴 + 넓은 본문), 폭이 좁아지면
 * 메뉴가 아이콘 → 상단 탭으로 줄어든다. 화면 전환은 주소의 #/admin/… 로 해서 새로고침·뒤로가기가 된다. */
export default function AdminConsole({ onExit }: { onExit: () => void }) {
  const [page, setPage] = useState<ConsolePage>(pageFromHash);

  useEffect(() => {
    if (!location.hash.startsWith(HASH_PREFIX)) location.hash = `${HASH_PREFIX}${page}`;
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [page]);

  const go = (id: ConsolePage) => {
    window.location.assign(`${HASH_PREFIX}${id}`);
  };

  return (
    <div className="console">
      <aside className="console-side">
        <div className="console-brand">
          <span className="console-logo" aria-hidden>
            <svg viewBox="0 0 64 64">
              <path d="M32 5 54 13v16c0 15-9.5 25.5-22 30C19.5 54.5 10 44 10 29V13z" fill="rgba(255,255,255,.2)" stroke="#fff" strokeWidth="4" strokeLinejoin="round" />
              <path d="M22 32.5 29 39.5 43 25" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="console-brand-text">
            <strong>AI파수꾼</strong>
            <small>본부 관리자 페이지</small>
          </span>
        </div>

        <nav className="console-nav" aria-label="관리자 메뉴">
          {NAV.map((n) => (
            <button key={n.id} className={n.id === page ? "on" : ""} onClick={() => go(n.id)} aria-current={n.id === page ? "page" : undefined} title={n.label}>
              <span className="console-nav-icon" aria-hidden>
                {n.icon}
              </span>
              <span className="console-nav-text">
                <strong>{n.label}</strong>
                <small>{n.hint}</small>
              </span>
            </button>
          ))}
        </nav>

        <div className="console-side-foot">
          <span className={`console-mode mode-${RESPONSE_SOURCE}`}>{RESPONSE_SOURCE === "demo" ? "DEMO 데이터" : "LOCAL 실데이터"}</span>
          <button className="c-btn c-btn-ghost" onClick={onExit}>
            ⇄ 역할 다시 선택
          </button>
        </div>
      </aside>

      <main className="console-main">
        {page === "rules" && <RulesPage />}
        {page === "monitoring" && <MonitoringPage />}
        {page === "stats" && <StatsPage />}
      </main>
    </div>
  );
}
