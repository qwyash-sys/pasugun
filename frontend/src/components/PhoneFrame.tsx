import type { ReactNode } from "react";
import { RESPONSE_SOURCE } from "../config";

export default function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="mode-pill">{RESPONSE_SOURCE.toUpperCase()} 모드</div>
      <div className="phone">
        <div className="phone-statusbar" />
        <div className="screen">{children}</div>
      </div>
    </>
  );
}
