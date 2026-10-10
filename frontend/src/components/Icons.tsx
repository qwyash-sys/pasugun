// 선 아이콘 모음(24×24, currentColor). 이모지는 기기·OS마다 모양이 달라 화면 톤이 흔들려서 직접 그린다.
import type { ReactNode } from "react";

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export const UserIcon = () => (
  <Svg>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20c1.2-3.6 4.1-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
  </Svg>
);

export const InspectIcon = () => (
  <Svg>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" />
    <path d="M14 3v4a1 1 0 0 0 1 1h4v2" />
    <path d="M8.5 9.5h3M8.5 13h2" />
    <circle cx="16.5" cy="16.5" r="3.2" />
    <path d="m19 19 2 2" />
  </Svg>
);

export const BuildingIcon = () => (
  <Svg>
    <path d="M3 21h18" />
    <path d="M5 21V9l7-5 7 5v12" />
    <path d="M9 21v-5h6v5" />
    <path d="M9 11h.01M12 11h.01M15 11h.01" />
  </Svg>
);

export const SlidersIcon = () => (
  <Svg>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Svg>
);

export const RadarIcon = () => (
  <Svg>
    <path d="M3 12h3l2.5-6 4 12 2.5-6h6" />
  </Svg>
);

export const ChartIcon = () => (
  <Svg>
    <path d="M4 20V4" />
    <path d="M4 20h16" />
    <rect x="7.5" y="11" width="3" height="6" rx="0.8" />
    <rect x="12.5" y="7" width="3" height="10" rx="0.8" />
    <rect x="17.5" y="13" width="3" height="4" rx="0.8" />
  </Svg>
);
