import { useLayoutEffect, useState, type RefObject } from "react";

/** Live content width of an element, measured before first paint. */
export const useElementWidth = (ref: RefObject<HTMLElement>) => {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return width;
};
