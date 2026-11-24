const borradas: string[] = [];
const fetchFalso = jest.fn();

jest.mock("next/headers", () => ({
  cookies: async () => ({ delete: (n: string) => borradas.push(n), set: jest.fn() }),
}));
jest.mock("next/navigation", () => ({ redirect: jest.fn() }));
jest.mock("@/lib/auth-cookies", () => ({ applyBackendSetCookies: jest.fn() }));
jest.mock("@/lib/api-server", () => ({ getApiBaseUrl: () => "http://backend/api/v1" }));
jest.mock("@/lib/auth", () => ({
  getBackendCookieHeader: async () => "access_token=x",
  getCsrfToken: async () => "csrf",
  getCurrentUser: jest.fn(),
  isRedirectError: () => false,
}));

import { logoutAction } from "./auth";

beforeEach(() => {
  borradas.length = 0;
  global.fetch = fetchFalso as unknown as typeof fetch;
  fetchFalso.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("logoutAction", () => {
  it("borra las tres cookies de sesion aunque el backend responda con error", async () => {
    fetchFalso.mockResolvedValue({ ok: false, status: 403, headers: new Headers() });
    await expect(logoutAction()).resolves.toEqual({ success: true });
    expect(borradas).toEqual(["access_token", "refresh_token", "csrf_token"]);
  });

  it("las borra tambien si el backend esta caido", async () => {
    fetchFalso.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(logoutAction()).resolves.toEqual({ success: true });
    expect(borradas).toEqual(["access_token", "refresh_token", "csrf_token"]);
  });
});
