"use client";
import { useEffect, useState } from 'react';
export function useTvPage(active: boolean) {
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTurn(value => value + 1), 15000);
    return () => clearInterval(timer);
  }, [active]);
  return turn;
}
