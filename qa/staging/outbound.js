"use strict";
(() => {
  const [target, query = ""] = location.hash.slice(1).split("?", 2);
  const [channel, recipient] = target.split("/", 2);
  const title = {whatsapp: "Черновик WhatsApp", call: "Проверка звонка", map: "Проверка адреса"}[channel];
  if (title) document.getElementById("qaOutboundTitle").textContent = title;
  if (recipient) {
    try {
      document.getElementById("qaOutboundRecipient").textContent =
        (channel === "map" ? "Адрес " : "Получатель ") + decodeURIComponent(recipient);
    } catch (_) { /* An invalid draft fragment cannot be opened externally. */ }
  }
  document.getElementById("qaOutboundText").textContent = new URLSearchParams(query).get("text") || "";
})();
