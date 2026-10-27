/* Read-only regression checks for the iPhone order sheet.
   Run: node tests/mobile-order-form.js
   No credentials, browsers, network or Supabase requests. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "mobile-order-form.css"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert(script, "inline app script must exist");
assert.doesNotThrow(() => new Function(script), "inline script must parse");
assert(html.includes('<link rel="stylesheet" href="/mobile-order-form.css">'), "new CSS must be linked");
assert.equal((html.match(/class="order-submit-bar"/g) || []).length, 1, "one order save bar");
assert.equal((html.match(/id="formStatus"/g) || []).length, 1, "one status live region");
assert(html.includes('form.addEventListener("invalid"'), "required field feedback");
assert(script.includes('if(orderSaving)return;'), "no concurrent submissions");
assert(script.includes('saveBtn.textContent="Сохраняем…"'), "immediate busy feedback");
assert(script.includes('saveBtn.textContent="Сохранить заказ"'), "label reset after save");
assert(script.includes('(pointer: coarse)'), "no automatic keyboard on touchscreen");
assert(css.includes("overflow-x: hidden"), "sheet must not scroll horizontally");
assert(css.includes("overflow-y: auto"), "sheet must still scroll vertically");
assert(css.includes("touch-action: pan-y pinch-zoom"), "vertical gestures remain available");
assert(css.includes("grid-template-columns: repeat(2, minmax(0, 1fr))"), "narrow grid min-width fix");
assert(css.includes("position: sticky"), "save action stays visible");
console.log("Mobile order form regression checks: PASS");
