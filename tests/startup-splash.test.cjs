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
  for (const tag of ["<h1", "<h2", "<p>", "<p ", "<span", "<button", "<img"]) {
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

test("premium splash softly animates halo, water, and droplet without adding visible text",()=>{
  const css=html.match(/\/\* Premium water-flow splash:[\s\S]*?@media\(prefers-reduced-motion:reduce\)[\s\S]*?\n    }/)?.[0]||"";
  assert.ok(css,"premium startup styles are present");
  assert.match(css,/\.rd-startup-content::before/,"ambient halo");
  assert.match(css,/@keyframes rd-startup-halo/);
  assert.match(css,/@keyframes rd-startup-glimmer/);
  assert.match(css,/\.rd-startup-radiator\{[\s\S]*?width:min\(260px,72vw\)/);
  assert.match(css,/\.rd-startup-flow\{[\s\S]*?animation:rd-startup-water-flow 2\.9s linear infinite/);
  assert.match(splash,/class="rd-startup-glint"/);
  assert.match(splash,/pathLength="320"/,"existing water-flow geometry retained");
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(css,/\.rd-startup-flow,\.rd-startup-content::before\{animation:none!important\}/);
  assert.doesNotMatch(splash,/<img|<video|<script|<h1|<p[\s>]/);
});

test("iOS Home Screen launch images are pixel-exact PNGs and linked in HTML",()=>{
  const sizes=[
    [390,844,1170,2532],
    [393,852,1179,2556],
    [402,874,1206,2622],
    [430,932,1290,2796]
  ];
  const startupLinks=[...html.matchAll(/<link rel="apple-touch-startup-image"[^>]+>/g)];
  assert.equal(startupLinks.length,sizes.length);
  for(const [logicalW,logicalH,w,h] of sizes){
    const pathName="icons/startup/startup-"+w+"x"+h+".png";
    const file=path.join(__dirname,"..",pathName);
    const png=fs.readFileSync(file);
    assert.ok(png.length>1000&&png.length<100000,pathName+" image size");
    assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10],pathName+" signature");
    assert.equal(png.readUInt32BE(16),w,pathName+" width");
    assert.equal(png.readUInt32BE(20),h,pathName+" height");
    const tag=startupLinks.find(m=>m[0].includes('href="/'+pathName+'"'))?.[0];
    assert.ok(tag,pathName+" linked");
    assert.ok(tag.includes("device-width: "+logicalW+"px"));
    assert.ok(tag.includes("device-height: "+logicalH+"px"));
    assert.ok(tag.includes("-webkit-device-pixel-ratio: 3"));
    assert.ok(tag.includes("orientation: portrait"));
  }
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,"..","manifest.webmanifest"),"utf8"));
  assert.equal(manifest.background_color,"#fbfcff");
  assert.equal(manifest.theme_color,"#fbfcff");
  assert.match(html,/<meta name="theme-color" content="#fbfcff">/);
  assert.match(html,/function showScreen\(which\)/);
  assert.match(html,/document\.getElementById\(id\)\.hidden = \(id !== which\)/);
});
