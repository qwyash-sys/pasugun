import { RESPONSE_SOURCE } from "../../config";
import type { AdminApi } from "./adminApi";
import { HttpAdminApi } from "./httpApi";
import { DemoAdminApi } from "./demoApi";

let instance: AdminApi | null = null;

/** 데모 모드면 브라우저 저장소 기반(DemoAdminApi), 그 외(local/remote)는 백엔드(HttpAdminApi). */
export function getAdminApi(): AdminApi {
  return (instance ??= RESPONSE_SOURCE === "demo" ? new DemoAdminApi() : new HttpAdminApi());
}

export { ConfigError } from "./adminApi";
export type { AdminApi } from "./adminApi";
