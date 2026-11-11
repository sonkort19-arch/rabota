const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const match = html.match(/<section id="startupScreen"\\b[\\s\\S]*?<\\/section>/);

test("startup screen contains only the animated SVG (no visible words or progress bar)", () => {
  assert.ok(match, "startupScreen must remain present");
  const splash = match[0];
  assert.match(splash, /<svg class="rd-startup-radiator"/);
  assert.match(splash, /class="rd-startup-droplet"/);
  assert.match(splash, /class="rd-startup-flow"/);
  assert.doesNotMatch(splash, /<(?:h1|h2|p|span|button|img)\\b/i);
  assert.equal(splash.replace(/<[^>]*>/g, "").trim(), "");
});

test("startup still offers accessible status and respects reduced motion", () => {
  assert.match(match[0], /role="status" aria-label="Загрузка приложения Работа"/);
  assert.match(html, /@media\\(prefers-reduced-motion:reduce\\)/);
  assert.match(html, /@keyframes rd-startup-water-flow/);
  assert.match(html, /@keyframes rd-startup-droplet-breathe/);
});

test("existing login and app transitions hide the splash without timeouts", () => {
  assert.match(html, /function showScreen\\(which\\)/);
  assert.match(html, /document\\.getElementById\\(id\\)\\.hidden = \\(id !== which\\)/);
  assert.match(html, /showScreen\\("appScreen"\\)/);
  assert.match(html, /showScreen\\("loginScreen"\\)/);
});
