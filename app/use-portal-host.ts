"use client";

import { useSyncExternalStore } from "react";

// These hosts are part of the workspace markup. React checks the DOM snapshot
// after hydration, keeping the server render free of browser-only DOM access.
const subscribe = () => () => {};
const serverSnapshot = () => null;
export default function usePortalHost(id: string) {
  return useSyncExternalStore(subscribe, () => document.getElementById(id), serverSnapshot);
}
