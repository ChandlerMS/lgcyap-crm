"use client";

import { useEffect, useRef, useState } from "react";

type ChatApi = {
  widget: { open(): void; close(): void; status(): { loaded: boolean } };
  on(event: string, callback: () => void): void;
  off(event: string, callback: () => void): void;
};
type ChatWindow = Window & { HubSpotConversations?: ChatApi; hsConversationsOnReady?: (() => void)[] };

export default function LegacyBotLauncher() {
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

  return <div className="legacy-bot-control" data-ready={ready} data-open={open}>
    <button ref={button} className="legacy-bot-launcher" type="button" disabled={!ready} aria-label={ready ? "Open Legacy Bot" : "Legacy Bot is loading"} aria-expanded={open} aria-controls="hubspot-messages-iframe-container" onClick={() => {
      const api = (window as ChatWindow).HubSpotConversations;
      if (api) { openedByUser.current = true; setOpen(true); api.widget.open(); }
    }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z" /><path d="M7 9h10M7 13h6" /></svg>
      <span>Legacy Bot</span>
    </button>
  </div>;
}
