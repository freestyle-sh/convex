import { useCallback, useLayoutEffect, useRef, useState } from "react";

// Keep a following conversation at its end before paint, including changes
// that arrive outside React (chart sizing, fonts, and expanded tool output).
export function useChatScroll(scope: string | undefined) {
  const [viewport, scroll] = useState<HTMLDivElement | null>(null);
  const [body, content] = useState<HTMLDivElement | null>(null);
  const follow = useRef(true);
  const lastTop = useRef(0);
  const pin = useCallback(() => {
    const el = viewport;
    if (!el || !el.clientHeight || !follow.current) return;
    el.style.overflowAnchor = "none";
    el.scrollTop = el.scrollHeight;
    lastTop.current = el.scrollTop;
  }, [viewport]);

  useLayoutEffect(() => {
    follow.current = true;
    if (scope) pin();
    else if (viewport) viewport.scrollTop = 0;
    lastTop.current = viewport?.scrollTop ?? 0;
  }, [scope, pin, viewport]);
  useLayoutEffect(() => {
    if (scope) pin();
  });
  useLayoutEffect(() => {
    const el = viewport;
    if (!scope || !el || !body) return;
    const observer = new ResizeObserver(pin);
    observer.observe(el);
    observer.observe(body);
    return () => observer.disconnect();
  }, [scope, pin, viewport, body]);

  const onScroll = useCallback(() => {
    const el = viewport;
    if (!el || !el.clientHeight) return;
    const atEnd = el.scrollHeight - el.clientHeight - el.scrollTop <= 2;
    if (el.scrollTop < lastTop.current - 1) follow.current = false;
    if (atEnd) follow.current = true;
    lastTop.current = el.scrollTop;
    // Browser anchoring preserves the reader's position when older messages
    // are prepended. Explicit following owns scroll only at the bottom.
    el.style.overflowAnchor = follow.current ? "none" : "auto";
  }, [viewport]);
  return { scroll, content, follow, onScroll };
}
