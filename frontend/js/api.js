/**
 * Chamadas ao backend (FastAPI) e ao proxy do Businessmap.
 * A API Key do Businessmap fica apenas no navegador do usuário e é enviada
 * no header X-Businessmap-Key a cada chamada /api/bm/*.
 */

import { storage } from "./ui.js";

export const API_BASE = window.APP_CONFIG?.API_URL || "";

const KEY_STORAGE = "bm_api_key";
const USER_STORAGE = "bm_user";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = "GET", body, bm = false, raw = false } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (bm) {
    const key = getApiKey();
    if (!key) throw new ApiError("Configure sua API Key do Businessmap.", 401);
    headers["X-Businessmap-Key"] = key;
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Não foi possível conectar ao servidor. Se ele estava inativo, aguarde alguns segundos e tente de novo.", 0);
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    let detail = data?.detail;
    if (Array.isArray(detail)) detail = detail.map((d) => d.msg).join("; ");
    throw new ApiError(detail || `Erro ${response.status}`, response.status);
  }
  return raw ? response : response.json();
}

// ---------- chave e usuário ----------

export function getApiKey() {
  return storage.get(KEY_STORAGE, "") || "";
}

export function setApiKey(key) {
  storage.set(KEY_STORAGE, key.trim());
}

export function clearApiKey() {
  storage.remove(KEY_STORAGE);
  storage.remove(USER_STORAGE);
  cardsCache.clear();
}

export function getBmUser() {
  return storage.get(USER_STORAGE, null);
}

// ---------- backend geral ----------

export const api = {
  health: () => request("/api/health"),
  states: () => request("/api/states"),
  holidays: (year, uf) => request(`/api/holidays/${year}/${encodeURIComponent(uf)}`),
  exportExcel: (payload) => request("/api/export", { method: "POST", body: payload, raw: true }),
};

// ---------- Businessmap ----------

const cardsCache = new Map();

export const bm = {
  async me() {
    const user = await request("/api/bm/me", { bm: true });
    storage.set(USER_STORAGE, user);
    return user;
  },

  async ensureUser() {
    return getBmUser() || bm.me();
  },

  async boards() {
    if (!cardsCache.has("boards")) cardsCache.set("boards", (await request("/api/bm/boards", { bm: true })).boards);
    return cardsCache.get("boards");
  },

  async myCards({ refresh = false } = {}) {
    const user = await bm.ensureUser();
    const key = `mine:${user.user_id}`;
    if (refresh || !cardsCache.has(key)) {
      const data = await request(`/api/bm/cards?scope=mine&user_id=${user.user_id}`, { bm: true });
      cardsCache.set(key, data.cards);
    }
    return cardsCache.get(key);
  },

  async boardCards(boardId, { refresh = false } = {}) {
    const key = `board:${boardId}`;
    if (refresh || !cardsCache.has(key)) {
      const data = await request(`/api/bm/cards?scope=board&board_id=${boardId}`, { bm: true });
      cardsCache.set(key, data.cards);
    }
    return cardsCache.get(key);
  },

  async subtasks(cardId) {
    return (await request(`/api/bm/cards/${cardId}/subtasks`, { bm: true })).subtasks;
  },

  async categories(boardId) {
    const key = `cat:${boardId}`;
    if (!cardsCache.has(key)) {
      const data = await request(`/api/bm/boards/${boardId}/categories`, { bm: true });
      cardsCache.set(key, data.categories);
    }
    return cardsCache.get(key);
  },

  async loggedTime(fromIso, toIso) {
    const user = await bm.ensureUser();
    const q = new URLSearchParams({ user_id: user.user_id, from: fromIso, to: toIso });
    return (await request(`/api/bm/logged-time?${q}`, { bm: true })).entries;
  },

  async conference(fromIso, toIso) {
    const user = await bm.ensureUser();
    const q = new URLSearchParams({ user_id: user.user_id, from: fromIso, to: toIso });
    return (await request(`/api/bm/conference?${q}`, { bm: true })).entries;
  },

  /** Edita tempo (minutos), comentário, data (AAAA-MM-DD) e/ou categoria — só os campos informados. */
  updateEntry(id, { minutes, comment, date, category_id }) {
    return request(`/api/bm/logged-time/${id}`, { method: "PATCH", bm: true, body: { minutes, comment, date, category_id } });
  },

  /** Remover categoria ou mudança recusada: cria um novo lançamento e exclui o antigo. */

  deleteEntry(id) {
    return request(`/api/bm/logged-time/${id}`, { method: "DELETE", bm: true });
  },

  async recreateEntry(id, item) {
    const user = await bm.ensureUser();
    return request(`/api/bm/logged-time/${id}/recreate`, { method: "POST", bm: true, body: { ...item, user_id: user.user_id } });
  },

  async createBatch(items) {
    const user = await bm.ensureUser();
    return request("/api/bm/logged-time/batch", { method: "POST", bm: true, body: { user_id: user.user_id, items } });
  },
};
