"use client";

import { useState } from "react";

const providers = [
  { name: "Gemini", url: "https://gemini.google.com/app" },
  { name: "Claude", url: "https://claude.ai/" },
  { name: "ChatGPT", url: "https://chatgpt.com/" },
  { name: "Grok", url: "https://grok.com/" },
];

export default function AiProviderLaunchers() {
  const [blocked, setBlocked] = useState<(typeof providers)[number] | null>(null);
  function launch(provider: (typeof providers)[number]) {
    // Open synchronously during the click so the browser sees a user gesture.
    const width = Math.min(960, window.screen.availWidth);
    const height = Math.min(800, window.screen.availHeight);
    const popup = window.open("about:blank", "_blank", `popup=yes,width=${width},height=${height},resizable=yes,scrollbars=yes`);
    if (!popup) { setBlocked(provider); return; }
    // Sever access to the CRM before navigating to the external provider.
    popup.opener = null;
    popup.location.replace(provider.url);
    popup.focus();
    setBlocked(null);
  }
  return <>
    {providers.map(provider => <button key={provider.name} type="button" className="ai-provider-launcher btn btn-secondary" aria-label={`Open ${provider.name} in a separate window`} onClick={() => launch(provider)}>{provider.name}</button>)}
    {blocked && <div className="ai-popup-notice" role="status">
      <p>Your browser blocked the {blocked.name} window. Allow pop-ups for this website and try again, or <a href={blocked.url} target="_blank" rel="noopener noreferrer">open {blocked.name} in a new tab</a>.</p>
      <button type="button" className="btn btn-quiet" onClick={() => setBlocked(null)} aria-label="Dismiss popup notice">×</button>
    </div>}
  </>;
}
