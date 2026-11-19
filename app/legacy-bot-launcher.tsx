"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AiProviderLaunchers from "./ai-provider-launchers";
import { legacyBotPosition } from "./legacy-bot-position.mjs";

type ChatApi = {
  widget: { open(): void; close(): void; status(): { loaded: boolean } };
  on(event: string, callback: () => void): void;
  off(event: string, callback: () => void): void;
};
type ChatWindow = Window & { HubSpotConversations?: ChatApi; hsConversationsOnReady?: (() => void)[] };

export default function LegacyBotLauncher() {
  const [dock, setDock] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setDock(document.getElementById("legacy-bot-dock")));
    return () => cancelAnimationFrame(frame);
  }, []);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const openedByUser = useRef(false);

  useEffect(() => {
    const chatWindow = window as ChatWindow;
    let api: ChatApi | undefined;
    let active = true;
    const closed = () => {
      if (!active) return;
      setOpen(false);
      if (openedByUser.current) button.current?.focus({ preventScroll: true });
      openedByUser.current = false;
    };
    const loaded = () => {
      if (!active) return;
      api?.widget.close();
      setReady(true);
    };
    const initialize = () => {
      if (!active) return;
      api = chatWindow.HubSpotConversations;
      api?.on("widgetClosed", closed);
      api?.on("widgetLoaded", loaded);
      if (api?.widget.status().loaded) loaded();
    };
    if (chatWindow.HubSpotConversations) initialize();
    else (chatWindow.hsConversationsOnReady ??= []).push(initialize);
    return () => {
      active = false;
      api?.off("widgetClosed", closed);
      api?.off("widgetLoaded", loaded);
      chatWindow.hsConversationsOnReady = chatWindow.hsConversationsOnReady?.filter(callback => callback !== initialize);
    };
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    let container: HTMLElement | null = null;
    let frame = 0;
    const place = () => {
      const launcher = button.current;
      if (!container || !launcher) return;
      const viewport = { width: document.documentElement.clientWidth, height: window.innerHeight };
      const position = legacyBotPosition(launcher.getBoundingClientRect(), { width: container.offsetWidth, height: container.offsetHeight }, viewport);
      container.style.setProperty("--legacy-bot-left", `${position.left}px`);
      container.style.setProperty("--legacy-bot-top", `${position.top}px`);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); };
    const sizes = new ResizeObserver(schedule);
    const attach = () => {
      const next = document.getElementById("hubspot-messages-iframe-container");
      if (next === container) return;
      if (container) sizes.unobserve(container);
      container = next;
      if (container) { sizes.observe(container); place(); }
    };
    // HubSpot can insert or replace its container after widget.open().
    const changes = new MutationObserver(attach);
    changes.observe(document.body, { childList: true, subtree: true });
    attach();
    if (button.current) sizes.observe(button.current);
    if (dock?.parentElement) sizes.observe(dock.parentElement);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      cancelAnimationFrame(frame); sizes.disconnect(); changes.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      container?.style.removeProperty("--legacy-bot-left");
      container?.style.removeProperty("--legacy-bot-top");
    };
  }, [open, dock]);

  const control = <><div className="legacy-bot-control" data-ready={ready} data-open={open}>
    <button ref={button} className="legacy-bot-launcher" type="button" disabled={!ready} aria-label={ready ? "Open Legacy Bot" : "Legacy Bot is loading"} aria-expanded={open} aria-controls="hubspot-messages-iframe-container" onClick={() => {
      const api = (window as ChatWindow).HubSpotConversations;
      if (api) { openedByUser.current = true; setOpen(true); api.widget.open(); }
    }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z" /><path d="M7 9h10M7 13h6" /></svg>
      <span>Legacy Bot</span>
    </button>
  </div><AiProviderLaunchers /></>;
  return dock ? createPortal(control, dock) : control;
}
