/* Keep the fixed workspace inside the viewport visible to the user. */
"use strict";
(() => {
  const viewport = window.visualViewport;
  if (!viewport) return;

  const root = document.documentElement;
  let pending = false;
  let previousTop = 0;
  let previousBottom = 0;
  let previousHeight = 0;

  function update() {
    pending = false;
    const height = Math.round(viewport.height);
    if (height <= 0) return;
    // Pinch zoom keeps native browser positioning and scrolling.
    const unzoomed = Math.abs(viewport.scale - 1) < 0.01;
    const top = unzoomed ? Math.max(0, Math.round(viewport.offsetTop)) : 0;
    const bottom = unzoomed ? Math.max(0, root.clientHeight - top - height) : 0;
    const visibleHeight = top || bottom ? height : 0;
    if (top === previousTop && bottom === previousBottom && visibleHeight === previousHeight) return;

    previousTop = top;
    previousBottom = bottom;
    previousHeight = visibleHeight;
    root.style.setProperty("--rd-viewport-top", top + "px");
    root.style.setProperty("--rd-viewport-bottom", bottom + "px");
    if (visibleHeight) root.style.setProperty("--rd-visual-height", visibleHeight + "px");
    else root.style.removeProperty("--rd-visual-height");
  }

  function schedule() {
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(update);
  }

  update();
  viewport.addEventListener("resize", schedule);
  viewport.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  window.addEventListener("pageshow", schedule);
  document.addEventListener("visibilitychange", schedule);
})();
