"use client";

import { useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";

type LauncherProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "aria-expanded"> & {
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  ref?: Ref<HTMLButtonElement>;
};

// All bottom panel launchers share the same open/collapse contract.
export default function FloatingLauncher({ expanded, onExpand, onCollapse, ...props }: LauncherProps) {
  return <button {...props} title={props.title ?? props["aria-label"]} type="button" aria-expanded={expanded} onClick={expanded ? onCollapse : onExpand} />;
}

export function FloatingActions({ children }: { children: ReactNode }) {
  const dock = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = dock.current;
    if (!element) return;
    const measure = () => document.documentElement.style.setProperty("--floating-actions-clearance", `${Math.ceil(window.innerHeight - element.getBoundingClientRect().top)}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      document.documentElement.style.removeProperty("--floating-actions-clearance");
    };
  }, []);
  return <div ref={dock} className="floating-actions">{children}</div>;
}
