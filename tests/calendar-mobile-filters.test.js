/* Calendar filter layout regression checks. Read-only: no DB/API calls.
   Run: node --test tests/calendar-mobile-filters.test.js */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(root, "calendar-v3.css"), "utf8");
const script = fs.readFileSync(path.join(root, "redesign.js"), "utf8");
const mobile = css.slice(css.indexOf("@media(max-width:790px)"), css.indexOf("@media(max-width:380px)"));
const smallest = css.slice(css.indexOf("@media(max-width:380px)"));

test("mobile toolbar uses a stable navigation row and a flexible remaining column", () => {
  assert.match(mobile, /#rdCalendarNavigation\s*\{[^}]*grid-template-columns:44px 44px minmax\(0,1fr\)/);
  assert.match(smallest, /#rdCalendarNavigation\s*\{[^}]*grid-template-columns:40px 40px minmax\(0,1fr\)/);
  assert.match(mobile, /\.rd-cal-today\s*\{[^}]*grid-column:3;grid-row:1/);
});
test("iPhone date, master and status never share the same narrow grid row", () => {
  const combined = /#rdCalendarDate,\s*body\.rd #rdCalendarNavigation #rdCalendarMaster,\s*body\.rd #rdCalendarNavigation #rdCalendarStatus\s*\{([^}]+)\}/.exec(mobile);
  assert.ok(combined, "shared full-width field rule exists");
  assert.match(combined[1], /grid-column:1\/-1/);
  assert.match(combined[1], /width:100%;min-width:0;max-width:100%/);
  assert.match(combined[1], /font-size:16px/);
  assert.match(mobile, /#rdCalendarDate\s*\{grid-row:2\}/);
  assert.match(mobile, /#rdCalendarMaster\s*\{grid-row:3\}/);
  assert.match(mobile, /#rdCalendarStatus\s*\{grid-row:4\}/);
  assert.doesNotMatch(mobile, /#rdCalendarDate\s*\{grid-column:1\/3\}/);
});
test("calendar controls retain real navigation and filter change handlers", () => {
  assert.match(script, /calendarSelect\.addEventListener\("change"/);
  assert.match(script, /calendarMasterSelect\.addEventListener\("change"/);
  assert.match(script, /calendarStatusSelect\.addEventListener\("change"/);
  assert.match(script, /calendarNav\.append\(previous,next,todayBtn,calendarSelect,calendarMasterSelect,calendarStatusSelect\)/);
  assert.match(script, /\/\/ Filters are visual only\. Never edit real orders during a calendar redraw\./);
});
