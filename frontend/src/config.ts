// SPEC 1장 "실행 모드(3단 스위치)". 화면 코드는 하나로 공유하고 응답 소스만 바꾼다.
export type ResponseSource = "demo" | "local" | "remote";

export const RESPONSE_SOURCE: ResponseSource =
  (import.meta.env.VITE_RESPONSE_SOURCE as ResponseSource) || "demo";

export const API_BASE_URL: string =
  RESPONSE_SOURCE === "remote"
    ? import.meta.env.VITE_REMOTE_API_BASE_URL || ""
    : import.meta.env.VITE_LOCAL_API_BASE_URL || "http://localhost:8000";

export const NH_GREEN = "#2E9A4A";
