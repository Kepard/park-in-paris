import { useCallback, useLayoutEffect, useState, useSyncExternalStore, type RefObject } from "react";

export const phone = matchMedia("(max-width: 760px)");
export const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

export function useMediaQuery(query: MediaQueryList) {
  const subscribe = useCallback((notify: () => void) => {
    query.addEventListener("change", notify);
    return () => query.removeEventListener("change", notify);
  }, [query]);
  return useSyncExternalStore(subscribe, () => query.matches);
}

// Give the map the sheet's resting height. Its WebGL canvas stays full-size while
// Motion moves the sheet, so a transition doesn't reallocate the canvas every frame.
export function useSheetInset(sheet: RefObject<HTMLElement | null>, mobile: boolean) {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const element = sheet.current;
    if (!element || !mobile) return;
    const measure = () => setHeight(element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // Safari's keyboard changes the visual viewport independently of 100dvh.
    const viewport = window.visualViewport;
    const sizeViewport = () => {
      if (viewport && viewport.scale === 1)
        document.documentElement.style.setProperty("--visible-height", `${viewport.height}px`);
    };
    sizeViewport();
    viewport?.addEventListener("resize", sizeViewport);
    return () => {
      observer.disconnect();
      viewport?.removeEventListener("resize", sizeViewport);
      document.documentElement.style.removeProperty("--visible-height");
    };
  }, [sheet, mobile]);
  return mobile ? height : 0;
}
