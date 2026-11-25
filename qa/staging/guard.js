/* QA-only transport boundary. The deployment CSP independently limits network requests. */
(function (root) {
  "use strict";
  function isAllowedDatabaseRequest(url, method, origin) {
    if (url.origin !== origin || url.username || url.password) return false;
    if (url.pathname === "/auth/v1/token") {
      return method === "POST" && ["password", "refresh_token"].includes(url.searchParams.get("grant_type"));
    }
    if (url.pathname === "/auth/v1/user") return method === "GET";
    if (url.pathname === "/auth/v1/logout") return method === "POST";
    if (url.pathname === "/rest/v1/rabota_push_subscriptions" ||
        url.pathname === "/rest/v1/rpc/rabota_register_push_subscription") return false;
    return /^\/rest\/v1\/(?:rpc\/)?rabota_[a-z0-9_]+$/.test(url.pathname) &&
      ["GET", "HEAD", "POST", "PATCH", "DELETE"].includes(method);
  }

  function install(origin, win = root) {
    const nativeFetch = win.fetch.bind(win);
    const nativeOpen = win.open.bind(win);
    const pageOrigin = win.location.origin;
    const failure = () => new TypeError("В тестовой среде внешний запрос отключён.");
    win.fetch = (input, options) => {
      let url;
      try {
        url = new URL(input?.url || input, win.location.href);
      } catch (_) {
        return Promise.reject(failure());
      }
      const method = String(options?.method || input?.method || "GET").toUpperCase();
      if (url.origin === pageOrigin && url.pathname === "/api/ai-chat" && method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({
          reply: "Тестовый ответ ИИ. Черновик сохранён в тестовой CRM. Внешний сервис не вызывался."
        }), {headers: {"Content-Type": "application/json"}}));
      }
      if (!isAllowedDatabaseRequest(url, method, origin)) return Promise.reject(failure());
      // Never forward Supabase authorization headers across a redirect.
      return nativeFetch(input, {...options, redirect: "error"});
    };
    win.open = (target, ...args) => {
      const url = new URL(target || "/", win.location.href);
      if (url.origin !== pageOrigin) return null;
      return nativeOpen(url.href, ...args);
    };
    function preventExternalNavigation(event) {
      const link = event.target?.closest?.("a[href]");
      if (!link || new URL(link.href, win.location.href).origin === pageOrigin) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    for (const event of ["click", "auxclick", "contextmenu"]) {
      win.document.addEventListener(event, preventExternalNavigation, true);
    }
  }

  if (typeof module === "object" && module.exports) {
    module.exports = {install, isAllowedDatabaseRequest};
  } else {
    const origin = root.document.currentScript?.dataset.qaSupabaseOrigin;
    if (!origin) throw Error("Не задан адрес тестовой базы.");
    install(origin);
  }
})(typeof window === "object" ? window : globalThis);
