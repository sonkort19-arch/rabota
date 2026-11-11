const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const start = html.indexOf('<section id="startupScreen"');
const end = html.indexOf("</section>", start);
const splash = start >= 0 && end > start ? html.slice(start, end + "</section>".length) : "";

test("startup screen contains the logo only, without captions or progress bar", () => {
  assert.ok(splash, "startupScreen must remain present");
  assert.ok(splash.includes('<svg class="rd-startup-radiator"'));
  assert.ok(splash.includes('class="rd-startup-droplet"'));
  assert.ok(splash.includes('class="rd-startup-flow"'));
  for (const tag of ["<h1", "<h2", "<p", "<span", "<button", "<img"]) {
    assert.ok(!splash.includes(tag), "unexpected text/control element: " + tag);
  }
  assert.equal(splash.replace(/<[^>]*>/g, "").trim(), "");
});

test("splash remains accessible and supports reduced motion", () => {
  assert.ok(splash.includes('role="status" aria-label="Загрузка приложения Работа"'));
  assert.ok(html.includes("@media(prefers-reduced-motion:reduce)"));
  assert.ok(html.includes("@keyframes rd-startup-water-flow"));
  assert.ok(html.includes("@keyframes rd-startup-droplet-breathe"));
});

test("login and app transitions continue to hide splash without delay", () => {
  assert.ok(html.includes("function showScreen(which)"));
  assert.ok(html.includes("document.getElementById(id).hidden = (id !== which)"));
  assert.ok(html.includes('showScreen("appScreen")'));
  assert.ok(html.includes('showScreen("loginScreen")'));
});
