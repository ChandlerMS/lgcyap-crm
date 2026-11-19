"use client";
import { useEffect, useState } from "react";
import InboxWorkspace from "./inbox-workspace";
const noop = () => {};
export default function PrivateEmailPanel({ onUnauthorized = noop, compact = true, disabled = false }: { onUnauthorized?: () => void; compact?: boolean; disabled?: boolean }) {
  const [canRead, setCanRead] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (disabled) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/email", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (response.status === 401) { onUnauthorized(); return; }
        const result = await response.json();
        if (!response.ok) throw Error("Received email is unavailable. Refresh this page to try again.");
        if (!controller.signal.aborted) { setCanRead(result.canRead === true); setError(""); }
      } catch { if (!controller.signal.aborted) setError("Received email status is unavailable. Refresh this page to try again."); }
    })();
    return () => controller.abort();
  }, [disabled, onUnauthorized]);
  if (disabled) return null;
  if (error) return <p className="helper" role="alert">{error}</p>;
  if (!canRead) return null;
  return <div>
    <p className="helper">Private received email for chandler@lgcyap.com, supplied by HubSpot. <a className="text-link" href="https://app.hubspot.com/settings/50894788/inbox/inboxes" target="_blank" rel="noopener noreferrer">Connect or manage your HubSpot mailbox</a>.</p>
    <InboxWorkspace compact onUnauthorized={onUnauthorized} endpoint="/api/email" label="Received email" headingLevel={compact ? 3 : 2} showCompose={false} />
  </div>;
}
