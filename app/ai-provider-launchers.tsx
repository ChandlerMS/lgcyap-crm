"use client";

import { useEffect, useRef, useState } from "react";

const providers = [
  { name: "Gemini", url: "https://gemini.google.com/app" },
  { name: "Claude", url: "https://claude.ai/" },
  { name: "ChatGPT", url: "https://chatgpt.com/" },
  { name: "Grok", url: "https://grok.com/" },
];

export default function AiProviderLaunchers() {
  const [active, setActive] = useState<string | null>(null);
  const [visited, setVisited] = useState<string[]>([]);
  const triggers = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    if (active) document.getElementById(`ai-title-${active}`)?.focus();
  }, [active]);
  function close(name: string) {
    setActive(null);
    triggers.current[name]?.focus();
  }
  return <>
    {providers.map(provider => <button key={provider.name} ref={element => { triggers.current[provider.name] = element; }} type="button" className="ai-provider-launcher btn btn-secondary" aria-expanded={active === provider.name} aria-controls={`ai-panel-${provider.name}`} onClick={() => {
      setVisited(current => current.includes(provider.name) ? current : [...current, provider.name]);
      setActive(current => current === provider.name ? null : provider.name);
    }}>{provider.name}</button>)}
    {providers.filter(provider => visited.includes(provider.name)).map(provider => <section key={provider.name} id={`ai-panel-${provider.name}`} className="ai-provider-panel" role="dialog" aria-label={provider.name} hidden={active !== provider.name} onKeyDown={event => { if (event.key === "Escape") close(provider.name); }}>
      <header><h2 id={`ai-title-${provider.name}`} tabIndex={-1}>{provider.name}</h2><a href={provider.url} target="_blank" rel="noopener noreferrer">Open in new tab ↗</a><button type="button" className="btn btn-quiet" aria-label={`Close ${provider.name}`} onClick={() => close(provider.name)}>×</button></header>
      <p>Embedding and sign-in depend on {provider.name}’s browser policies. If the window is blocked, open it in a new tab.</p>
      <iframe title={`${provider.name} assistant`} src={provider.url} allow="clipboard-write" />
    </section>)}
  </>;
}
