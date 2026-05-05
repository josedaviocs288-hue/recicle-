import axios, { AxiosError, AxiosHeaders, InternalAxiosRequestConfig } from "axios";
import { getToken, removeToken, removeUserType } from "./token";

const DEFAULT_API_URL = "https://reciclemais.app.br";

function normalizarBaseURL(url?: string | null) {
  let value = String(url || "").trim();
  if (!value) return DEFAULT_API_URL;

  value = value.replace(/\/+$/, "");

  // O backend real expõe as rotas na raiz: /auth, /doacoes, /rastreamento...
  // Se alguém configurar EXPO_PUBLIC_API_URL com /api, removemos para evitar
  // chamadas como /api/auth/register, que não são as rotas usadas em produção.
  if (value.toLowerCase().endsWith("/api")) {
    value = value.slice(0, -4);
  }

  return value || DEFAULT_API_URL;
}

export const API_BASE_URL = normalizarBaseURL(process.env.EXPO_PUBLIC_API_URL);

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    if (!config.headers) config.headers = new AxiosHeaders();

    const token = await getToken();

    if (token && token.trim() !== "") {
      config.headers.set("Authorization", `Bearer ${token}`);
    } else {
      config.headers.delete("Authorization");
    }

    return config;
  },
  (error: AxiosError) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<any>) => {
    if (error.response?.status === 401) {
      const url = error.config?.url ?? "";
      const rotaPublica =
        url === "/" ||
        url.startsWith("/auth/login") ||
        url.startsWith("/auth/register") ||
        url.startsWith("/actuator/health") ||
        url.startsWith("/health");

      if (!rotaPublica) {
        await removeToken();
        await removeUserType();
        delete api.defaults.headers.common.Authorization;
      }
    }

    return Promise.reject(error);
  }
);

export default api;
