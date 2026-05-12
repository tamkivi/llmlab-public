"use client";

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

const LAST_SLIDE = 2;
const FINAL_SLIDE_HOLD_MS = 350;
const SWIPE_THRESHOLD = 64;
const WHEEL_THRESHOLD = 32;
const TRANSITION_LOCK_MS = 760;

type ReleaseScrollTarget = "builds" | "catalog";

function isReloadNavigation(): boolean {
  const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return navigation?.type === "reload";
}

function scrollWindowByInstant(top: number) {
  if (Math.abs(top) < 1) return;

  const html = document.documentElement;
  const previousScrollBehavior = html.style.scrollBehavior;
  html.style.scrollBehavior = "auto";
  window.scrollBy({ top, left: 0, behavior: "auto" });
  html.style.scrollBehavior = previousScrollBehavior;
}

export function HomepageScrollStory({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeSlideRef = useRef(0);
  const finalSlideReadyAtRef = useRef(0);
  const lockRef = useRef(false);
  const releaseScrollRef = useRef<{
    behavior: ScrollBehavior;
    previousTop: number;
    target: ReleaseScrollTarget;
  } | null>(null);
  const storyReleasedRef = useRef(false);
  const unlockTimeoutsRef = useRef<number[]>([]);
  const touchStartYRef = useRef<number | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [storyReleased, setStoryReleased] = useState(false);

  const resetUrlHash = () => {
    if (!window.location.hash) return;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  };

  useEffect(() => {
    activeSlideRef.current = activeSlide;
  }, [activeSlide]);

  useEffect(() => {
    storyReleasedRef.current = storyReleased;
  }, [storyReleased]);

  useLayoutEffect(() => {
    const initialHash = window.location.hash;
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    if (initialHash && isReloadNavigation()) {
      resetUrlHash();
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });

      return () => {
        window.history.scrollRestoration = previousScrollRestoration;
      };
    }

    if (initialHash === "#component-catalog") {
      activeSlideRef.current = LAST_SLIDE;
      storyReleasedRef.current = true;
      rootRef.current?.setAttribute("data-story-released", "true");
      const timeoutId = window.setTimeout(() => {
        setActiveSlide(LAST_SLIDE);
        setStoryReleased(true);
        document
          .getElementById("component-catalog")
          ?.scrollIntoView({ behavior: "auto", block: "start" });
      }, 0);
      return () => {
        window.clearTimeout(timeoutId);
        window.history.scrollRestoration = previousScrollRestoration;
      };
    }

    if (initialHash === "#build-profiles") {
      activeSlideRef.current = LAST_SLIDE;
      finalSlideReadyAtRef.current = Date.now() + FINAL_SLIDE_HOLD_MS;
      const timeoutId = window.setTimeout(() => {
        setActiveSlide(LAST_SLIDE);
        rootRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
      }, 0);
      return () => {
        window.clearTimeout(timeoutId);
        window.history.scrollRestoration = previousScrollRestoration;
      };
    }

    if (initialHash) {
      return () => {
        window.history.scrollRestoration = previousScrollRestoration;
      };
    }

    window.scrollTo({ top: 0, left: 0, behavior: "auto" });

    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  useLayoutEffect(() => {
    if (!storyReleased) return;

    const pendingRelease = releaseScrollRef.current;
    if (!pendingRelease) return;

    releaseScrollRef.current = null;
    const root = rootRef.current;
    const target =
      pendingRelease.target === "catalog"
        ? document.getElementById("component-catalog")
        : root?.querySelector<HTMLElement>(".builds-scroll-panel");

    if (!target) return;

    if (pendingRelease.behavior === "smooth") {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const nextTop = target.getBoundingClientRect().top;
    scrollWindowByInstant(nextTop - pendingRelease.previousTop);
  }, [storyReleased]);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1024px)");

    const applyScrollLock = () => {
      document.documentElement.classList.toggle(
        "homepage-slides-locked",
        desktopQuery.matches && !storyReleased,
      );
    };

    applyScrollLock();
    desktopQuery.addEventListener("change", applyScrollLock);

    return () => {
      desktopQuery.removeEventListener("change", applyScrollLock);
      document.documentElement.classList.remove("homepage-slides-locked");
    };
  }, [storyReleased]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const desktopQuery = window.matchMedia("(min-width: 1024px)");

    const isDesktop = () => desktopQuery.matches;

    const isStoryInView = () => {
      const rect = root.getBoundingClientRect();
      return rect.top < window.innerHeight * 0.85 && rect.bottom > window.innerHeight * 0.15;
    };

    const clearUnlockTimers = () => {
      unlockTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      unlockTimeoutsRef.current = [];
    };

    const unlockLater = (delayMs = TRANSITION_LOCK_MS) => {
      clearUnlockTimers();
      const timeoutId = window.setTimeout(() => {
        lockRef.current = false;
        unlockTimeoutsRef.current = unlockTimeoutsRef.current.filter((id) => id !== timeoutId);
      }, delayMs);
      unlockTimeoutsRef.current.push(timeoutId);
    };

    const releaseStory = ({ targetCatalog = false } = {}) => {
      const target = targetCatalog
        ? document.getElementById("component-catalog")
        : root.querySelector<HTMLElement>(".builds-scroll-panel");

      releaseScrollRef.current = target
        ? {
            behavior: targetCatalog ? "smooth" : "auto",
            previousTop: target.getBoundingClientRect().top,
            target: targetCatalog ? "catalog" : "builds",
          }
        : null;
      clearUnlockTimers();
      lockRef.current = false;
      storyReleasedRef.current = true;
      setStoryReleased(true);
      document.documentElement.classList.remove("homepage-slides-locked");
    };

    const moveSlide = (direction: 1 | -1) => {
      if (!isDesktop() || storyReleasedRef.current || lockRef.current || !isStoryInView()) {
        return false;
      }

      const currentSlide = activeSlideRef.current;
      const nextSlide = currentSlide + direction;

      if (direction < 0 && currentSlide === 0) {
        return false;
      }

      lockRef.current = true;
      if (direction > 0 && currentSlide === LAST_SLIDE) {
        const now = Date.now();
        if (now < finalSlideReadyAtRef.current) {
          unlockLater(finalSlideReadyAtRef.current - now);
          return true;
        }

        releaseStory();
        unlockLater();
        return true;
      }

      const clampedSlide = Math.max(0, Math.min(LAST_SLIDE, nextSlide));
      activeSlideRef.current = clampedSlide;
      storyReleasedRef.current = false;
      root.dataset.storyReleased = "false";
      setStoryReleased(false);
      if (clampedSlide === LAST_SLIDE) {
        finalSlideReadyAtRef.current = Date.now() + FINAL_SLIDE_HOLD_MS;
      }
      setActiveSlide(clampedSlide);
      root.scrollIntoView({ behavior: "smooth", block: "start" });
      unlockLater(clampedSlide === LAST_SLIDE ? FINAL_SLIDE_HOLD_MS : TRANSITION_LOCK_MS);
      return true;
    };

    const handleWheel = (event: WheelEvent) => {
      if (storyReleasedRef.current) return;
      if (!isDesktop() || Math.abs(event.deltaY) < WHEEL_THRESHOLD) return;
      if (!isStoryInView()) return;

      const direction = event.deltaY > 0 ? 1 : -1;
      if (lockRef.current) {
        event.preventDefault();
        return;
      }

      if (moveSlide(direction)) {
        event.preventDefault();
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      touchStartYRef.current = event.touches[0]?.clientY ?? null;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (storyReleasedRef.current) return;
      const startY = touchStartYRef.current;
      const currentY = event.touches[0]?.clientY;
      if (startY === null || currentY === undefined) return;

      const delta = startY - currentY;
      if (Math.abs(delta) < SWIPE_THRESHOLD) return;
      if (!isStoryInView()) return;

      const direction = delta > 0 ? 1 : -1;
      if (lockRef.current) {
        event.preventDefault();
        return;
      }

      if (moveSlide(direction)) {
        event.preventDefault();
        touchStartYRef.current = currentY;
      }
    };

    const handleClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const buildLink = target?.closest<HTMLAnchorElement>('a[href="#build-profiles"]');
      const componentLink = target?.closest<HTMLAnchorElement>('a[href="#component-catalog"]');
      const releaseControl = target?.closest<HTMLElement>("[data-release-scroll-story]");
      if (!isDesktop() || storyReleasedRef.current) return;

      if (releaseControl) {
        releaseStory();
        return;
      }

      if (buildLink) {
        event.preventDefault();
        resetUrlHash();
        if (lockRef.current) return;
        lockRef.current = true;
        activeSlideRef.current = LAST_SLIDE;
        finalSlideReadyAtRef.current = Date.now() + FINAL_SLIDE_HOLD_MS;
        storyReleasedRef.current = false;
        root.dataset.storyReleased = "false";
        setStoryReleased(false);
        setActiveSlide(LAST_SLIDE);
        root.scrollIntoView({ behavior: "smooth", block: "start" });
        unlockLater(FINAL_SLIDE_HOLD_MS);
      }

      if (componentLink) {
        event.preventDefault();
        resetUrlHash();
        releaseStory({ targetCatalog: true });
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isDesktop() || storyReleasedRef.current || !isStoryInView()) return;

      const downKeys = ["ArrowDown", "PageDown", " "];
      const upKeys = ["ArrowUp", "PageUp"];
      if (lockRef.current && (downKeys.includes(event.key) || upKeys.includes(event.key))) {
        event.preventDefault();
        return;
      }

      if (downKeys.includes(event.key) && moveSlide(1)) {
        event.preventDefault();
      }
      if (upKeys.includes(event.key) && moveSlide(-1)) {
        event.preventDefault();
      }
    };

    root.addEventListener("click", handleClick);
    window.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    window.addEventListener("touchstart", handleTouchStart, { passive: true, capture: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false, capture: true });
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      clearUnlockTimers();
      lockRef.current = false;
      root.removeEventListener("click", handleClick);
      window.removeEventListener("wheel", handleWheel, { capture: true });
      window.removeEventListener("touchstart", handleTouchStart, { capture: true });
      window.removeEventListener("touchmove", handleTouchMove, { capture: true });
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="homepage-scroll-story"
      data-active-slide={activeSlide}
      data-story-released={storyReleased}
    >
      {children}
    </div>
  );
}
