/** Keep animation state, but stop scheduling frames offscreen or in hidden tabs. */
export function runVisibleFrames(
  element: Element,
  draw: FrameRequestCallback,
): () => void {
  let frame = 0;
  let stopped = false;
  const rect = element.getBoundingClientRect();
  let visible = rect.bottom > 0 && rect.top < window.innerHeight;
  const tick: FrameRequestCallback = (time) => {
    frame = 0;
    if (stopped || !visible || document.hidden) return;
    draw(time);
    frame = requestAnimationFrame(tick);
  };
  const sync = () => {
    if (stopped) return;
    if (visible && !document.hidden) {
      if (!frame) frame = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
  const observer =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(([entry]) => {
          visible = entry?.isIntersecting ?? false;
          sync();
        });
  observer?.observe(element);
  document.addEventListener("visibilitychange", sync);
  sync();
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    document.removeEventListener("visibilitychange", sync);
  };
}
