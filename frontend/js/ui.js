/**
 * Helpers de interface: escape de HTML, ícones, toast, carregamento, diálogos e armazenamento local.
 */

const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapa qualquer valor para inserção segura em HTML. */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}

/** Referência a um ícone do sprite SVG definido no index.html. */
export function icon(name, cls = "") {
  return `<svg class="icon ${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- armazenamento local (sempre protegido) ----------

export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* indisponível */ }
  },
};

// ---------- toast ----------

let toastTimer;
export function toast(message, type = "info", ms = 3500) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.className = `toast toast-${type} is-visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), ms);
}

// ---------- carregamento ----------

let loadingCount = 0;
export function setLoading(on, message = "Carregando…") {
  loadingCount = Math.max(0, loadingCount + (on ? 1 : -1));
  const el = $("#loading");
  if (!el) return;
  $("#loading-text", el).textContent = message;
  el.hidden = loadingCount === 0;
}

export async function withLoading(message, fn) {
  setLoading(true, message);
  try {
    return await fn();
  } finally {
    setLoading(false);
  }
}

// ---------- diálogos ----------

export function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
  const focusable = dialog.querySelector("[autofocus], input, select, textarea, button:not([data-close])");
  focusable?.focus();
}

export function closeDialog(dialog) {
  if (dialog.open) dialog.close();
}

/** Fecha diálogos pelo botão [data-close] e ao clicar no fundo. */
export function setupDialogs() {
  document.addEventListener("click", (e) => {
    const closeBtn = e.target.closest("[data-close]");
    if (closeBtn) {
      closeDialog(closeBtn.closest("dialog"));
      return;
    }
    if (e.target instanceof HTMLDialogElement) {
      const r = e.target.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) closeDialog(e.target);
    }
  });
}

/** Confirmação simples usando o diálogo #confirm-dialog. */
export function confirmDialog({ title, message, confirmLabel = "Confirmar", danger = false }) {
  const dialog = $("#confirm-dialog");
  $("#confirm-title", dialog).textContent = title;
  $("#confirm-message", dialog).innerHTML = message;
  const ok = $("#confirm-ok", dialog);
  ok.textContent = confirmLabel;
  ok.classList.toggle("btn-danger", danger);
  ok.classList.toggle("btn-primary", !danger);
  return new Promise((resolve) => {
    const onClose = () => {
      dialog.removeEventListener("close", onClose);
      resolve(dialog.returnValue === "ok");
    };
    dialog.returnValue = "";
    dialog.addEventListener("close", onClose);
    openDialog(dialog);
  });
}

// ---------- tema ----------

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  else delete root.dataset.theme;
}

export function normalizeLabel(text) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
