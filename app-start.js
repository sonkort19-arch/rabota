/* Start once the workspace is available. Payment views can finish loading later. */
"use strict";
const shellStyle = document.querySelector('link[href^="/app-shell.css?"]');
if (!document.documentElement.dataset.rdBootFailed && shellStyle?.sheet && typeof initialize === "function" &&
    typeof window.__rdAccess === "function" && window.__rdOrdersWorkspace) {
  window.dispatchEvent(new Event("rd:boot"));
  void initialize();
}
