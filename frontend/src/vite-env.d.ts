/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RESPONSE_SOURCE?: "demo" | "local" | "remote";
  readonly VITE_LOCAL_API_BASE_URL?: string;
  readonly VITE_REMOTE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
