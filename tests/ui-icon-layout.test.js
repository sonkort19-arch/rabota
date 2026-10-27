/* UI geometry regression checks: read-only source inspection, no API/DB calls.
 * node --test tests/ui-icon-layout.test.js
 */
"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../redesign.js"),"utf8");
const css=fs.readFileSync(path.join(__dirname,"../ui-alignment.css"),"utf8");
const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
test("metric icons are adjacent to labels, while values remain a separate column",()=>{
 assert.ok(source.includes('heading.append(icon,boxText("small",label))'));
 assert.ok(source.includes('card.append(heading,statBody)'));
 assert.ok(source.includes('statBody.append(boxText("strong",item.value,"rd-accent"),boxText("span",item.hint,"rd-stat-hint"))'));
 assert.ok(!source.includes("card.append(icon,body)"));
});
test("global alignment stylesheet wins over earlier theme rules",()=>{
 const links=[...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(match=>match[1]);
 assert.equal(links.at(-1),"/ui-alignment.css");
 assert.ok(css.includes(".rd-stat .rd-stat-body strong.rd-accent"));
 assert.ok(css.includes(".rd-stat .rd-stat-body .rd-stat-hint"));
 assert.ok(css.includes(".rd-nav-btn .rd-icon .rd-svgicon"));
 assert.ok(css.includes(".rd-panel-heading>.rd-svgicon"));
});
test("icon alignment covers desktop and compact phone widths",()=>{
 assert.ok(css.includes("@media(max-width:790px)"));
 assert.ok(css.includes("@media(max-width:390px)"));
 assert.ok(css.includes("flex:0 0 23px"));
 assert.ok(css.includes("flex:0 0 38px"));
});
test("AI controls have exactly one decoration rather than duplicated glyphs",()=>{
 assert.ok(source.includes('panel("ИИ-помощник"'));
 assert.ok(!source.includes('panel("✦ ИИ-помощник"'));
 assert.ok(source.includes('makeNode("button","rd-quick",label)'));
 assert.ok(!source.includes('label+"  ›"'));
});
test("chart tooltips are event-driven; missing customer names cannot crash summary",()=>{
 assert.ok(source.includes("hideChartTip()"));
 assert.ok(source.includes('svg.addEventListener("mouseleave",hideChartTip)'));
 assert.ok(source.includes('String(o.name||"").toLocaleLowerCase("ru")'));
 new Function(source);
});
