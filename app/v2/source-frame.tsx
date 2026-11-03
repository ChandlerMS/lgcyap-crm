"use client";

import { useEffect, useRef, useState } from "react";
import { startOnboardFrame } from "@/lib/onboard-frame.mjs";
import styles from "./source-frame.module.css";

export default function SourceFrame() {
  const mount = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [run, setRun] = useState(0);

  useEffect(() => {
    const container = mount.current;
    if (!container) return;
    const stop = startOnboardFrame(() => {
      const frame = document.createElement("iframe");
      frame.className = styles.frame;
      frame.title = "Version 2 — LGCY Onboard";
      frame.allow = "clipboard-write";
      frame.inert = true;
      container.replaceChildren(frame);
      return frame;
    }, { onState: setState });
    return () => { stop(); container.replaceChildren(); };
  }, [run]);

  return <div className={styles.host} aria-busy={state === "loading"}>
    <div ref={mount} className={styles.mount} />
    {state !== "ready" && <div className={styles.status} role={state === "failed" ? "alert" : "status"}>
      <p>{state === "failed" ? "Version 2 could not finish loading." : "Loading Version 2…"}</p>
      {state === "failed" && <button onClick={() => setRun(value => value + 1)}>Try again</button>}
    </div>}
  </div>;
}
