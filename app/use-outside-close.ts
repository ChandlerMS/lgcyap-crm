"use client";
import { useEffect, useRef, type RefObject } from "react";

/**
 * Calls onOutside when a mouse press and its click both land outside the element: elsewhere on the page for an
 * inline panel, or on the dimmed backdrop of a modal dialog. A press inside that ends outside (a text selection
 * dragged out of a field) does not count, and neither does a click inside another open dialog.
 */
export function useOutsideClose(ref: RefObject<HTMLElement | null>, onOutside: () => void, active = true) {
  const callback = useRef(onOutside);
  useEffect(() => { callback.current = onOutside; });
  useEffect(() => {
    if (!active) return;
    let pressedOutside = false;
    const outside = (event: MouseEvent) => {
      const element = ref.current, target = event.target;
      if (!element || !(target instanceof Element) || target === document.documentElement) return false;
      // A modal dialog receives its backdrop's clicks itself, so those are judged by position.
      if (target === element) {
        const box = element.getBoundingClientRect();
        return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
      }
      return !element.contains(target) && !target.closest("dialog[open]");
    };
    const press = (event: PointerEvent) => { pressedOutside = event.button === 0 && outside(event); };
    const click = (event: MouseEvent) => { const close = pressedOutside && outside(event); pressedOutside = false; if (close) callback.current(); };
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("click", click, true);
    return () => { document.removeEventListener("pointerdown", press, true); document.removeEventListener("click", click, true); };
  }, [ref, active]);
}
