"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import styles from "./leaderboard.module.css";

const ITEM_HEIGHT = 40;
type Month = { key: string; label: string };

/** Scroll-snap wheel for choosing a month. Selection settles when scrolling stops; arrows, Home/End and clicks also select. */
export default function MonthWheel({ months, value, onChange, labelledBy }: { months: Month[]; value: string; onChange: (key: string) => void; labelledBy: string }) {
  const listRef = useRef<HTMLDivElement>(null);
  const settleRef = useRef(0);
  const index = Math.max(0, months.findIndex(month => month.key === value));
  const [position, setPosition] = useState(index);

  // Start centred on the selected month without animating.
  useLayoutEffect(() => { if (listRef.current) listRef.current.scrollTop = index * ITEM_HEIGHT; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Follow selections made by keyboard, click or another control.
  useEffect(() => {
    const list = listRef.current;
    if (!list || Math.round(list.scrollTop / ITEM_HEIGHT) === index) return;
    list.scrollTo({ top: index * ITEM_HEIGHT, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [index]);
  useEffect(() => () => window.clearTimeout(settleRef.current), []);

  const select = (next: number) => { const month = months[Math.min(months.length - 1, Math.max(0, next))]; if (month && month.key !== value) onChange(month.key); };
  const onScroll = () => {
    const list = listRef.current; if (!list) return;
    setPosition(list.scrollTop / ITEM_HEIGHT);
    window.clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(() => select(Math.round(list.scrollTop / ITEM_HEIGHT)), 140);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowUp: index - 1, ArrowDown: index + 1, PageUp: index - 3, PageDown: index + 3, Home: 0, End: months.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault(); select(moves[event.key]);
  };

  return <div className={styles.wheel}>
    <div ref={listRef} className={styles.wheelList} role="listbox" tabIndex={0} aria-labelledby={labelledBy} aria-activedescendant={`leaderboard-month-${value}`} onScroll={onScroll} onKeyDown={onKeyDown}>
      {months.map((month, item) => {
        const distance = item - position;
        return <div key={month.key} id={`leaderboard-month-${month.key}`} role="option" aria-selected={item === index} className={styles.wheelOption} style={{ transform: `rotateX(${Math.max(-75, Math.min(75, distance * -22))}deg)`, opacity: Math.max(.18, 1 - Math.abs(distance) * .34) }} onClick={() => select(item)}>{month.label}</div>;
      })}
    </div>
  </div>;
}
