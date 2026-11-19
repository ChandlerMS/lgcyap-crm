"use client";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./applications-page.module.css";

type View = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; url: string; type: string };

// One applicant's photo ID in a dialog. The file comes from HubSpot through the CRM's own private read, is shown from
// memory, and is released when the dialog closes, so it never has an address that can be opened or shared later.
export default function PhotoIdViewer({ noteId, name, onClose }: { noteId: string; name: string; onClose: () => void }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);
  const [view, setView] = useState<View>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { dialogRef.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    let url = "";
    void (async () => {
      try {
        const response = await fetch(`/api/applications/${encodeURIComponent(noteId)}/photo-id`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: "{}", signal: controller.signal });
        if (!response.ok) {
          const result = await response.json().catch(() => null);
          if (!controller.signal.aborted) setView({ status: "error", message: result?.error?.message ?? "The photo ID could not be loaded. Try again." });
          return;
        }
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setView({ status: "ready", url, type: blob.type });
      } catch {
        if (!controller.signal.aborted) setView({ status: "error", message: "The connection dropped. Try again." });
      }
    })();
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [noteId, attempt]);
  const close = () => { dialogRef.current?.close(); onClose(); };
  const onBackdrop = (event: { target: EventTarget; currentTarget: HTMLDialogElement; clientX: number; clientY: number }) => {
    const box = event.currentTarget.getBoundingClientRect();
    return event.target === event.currentTarget && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom);
  };
  const label = `Photo ID uploaded by ${name}`;
  return <dialog ref={dialogRef} className={`modal ${styles.photoDialog}`} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }}
    onPointerDown={event => { pressedOutside.current = onBackdrop(event); }}
    onClick={event => { const outside = pressedOutside.current && onBackdrop(event); pressedOutside.current = false; if (outside) close(); }}>
    <div className="dialog-header"><h2 id={titleId}>Photo ID<span className="muted"> · {name}</span></h2><button type="button" className="btn btn-quiet dialog-close" aria-label="Close" onClick={close}><span aria-hidden="true">×</span></button></div>
    <div className={`dialog-body ${styles.photoBody}`}>
      {view.status === "loading" && <p className={styles.empty} role="status">Loading the photo ID from HubSpot…</p>}
      {view.status === "error" && <div className="connection-alert" role="alert"><strong>Photo ID unavailable</strong><p>{view.message}</p><button type="button" className="btn btn-secondary" onClick={() => { setView({ status: "loading" }); setAttempt(value => value + 1); }}>Try again</button></div>}
      {view.status === "ready" && (view.type === "application/pdf"
        ? <iframe className={styles.photoPdf} src={view.url} title={`${label} (PDF)`} />
        : view.type === "image/heic"
          ? <p className={styles.photoNote}>This photo is in the iPhone HEIC format, which most browsers cannot show. <a href={view.url} download="photo-id.heic">Download it</a> to open it on this computer, then delete the copy.</p>
          // A blob from memory: next/image cannot load it.
          // eslint-disable-next-line @next/next/no-img-element
          : <img className={styles.photo} src={view.url} alt={label} />)}
      {view.status === "ready" && <p className={styles.photoNote}>Private: share it only with the hiring team. It is kept in HubSpot with the application.</p>}
    </div>
  </dialog>;
}
