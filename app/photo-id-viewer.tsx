"use client";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./applications-page.module.css";

export type PhotoNote = { noteId: string; files: number; source: "application" | "sign-in"; at: string };
type View = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; url: string; type: string };
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });

// One photo, fetched through the CRM's private read, shown from memory and released when the dialog closes, so it
// never has an address that can be opened or shared later.
function PhotoFrame({ noteId, file, label }: { noteId: string; file: number; label: string }) {
  const [view, setView] = useState<View>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let url = "";
    void (async () => {
      try {
        const response = await fetch(`/api/photo-ids/${encodeURIComponent(noteId)}?file=${file}`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: "{}", signal: controller.signal });
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
  }, [noteId, file, attempt]);
  return <figure className={styles.photoFrame}>
    <figcaption>{label}</figcaption>
    {view.status === "loading" && <p className={styles.empty} role="status">Loading the photo ID from HubSpot…</p>}
    {view.status === "error" && <div className="connection-alert" role="alert"><strong>Photo ID unavailable</strong><p>{view.message}</p><button type="button" className="btn btn-secondary" onClick={() => { setView({ status: "loading" }); setAttempt(value => value + 1); }}>Try again</button></div>}
    {view.status === "ready" && (view.type === "application/pdf"
      ? <iframe className={styles.photoPdf} src={view.url} title={`${label} (PDF)`} />
      : view.type === "image/heic"
        ? <p className={styles.photoNote}>This photo is in the iPhone HEIC format, which most browsers cannot show. <a href={view.url} download="photo-id.heic">Download it</a> to open it on this computer, then delete the copy.</p>
        // A blob from memory: next/image cannot load it.
        // eslint-disable-next-line @next/next/no-img-element
        : <img className={styles.photo} src={view.url} alt={label} />)}
  </figure>;
}

// Every photo ID a person gave, on the application and when signing in at an event, in one dialog.
export default function PhotoIdViewer({ photos, name, onClose }: { photos: PhotoNote[]; name: string; onClose: () => void }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);
  useEffect(() => { dialogRef.current?.showModal(); }, []);
  const close = () => { dialogRef.current?.close(); onClose(); };
  const onBackdrop = (event: { target: EventTarget; currentTarget: HTMLDialogElement; clientX: number; clientY: number }) => {
    const box = event.currentTarget.getBoundingClientRect();
    return event.target === event.currentTarget && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom);
  };
  const frames = photos.flatMap(photo => Array.from({ length: Math.min(photo.files, 4) }, (_, file) => {
    const from = photo.source === "application" ? "From the application" : `From the hiring event sign-in, ${DAY.format(Date.parse(photo.at))}`;
    const side = photo.files === 2 ? (file ? " · back" : " · front") : photo.files > 2 ? ` · ${file + 1} of ${photo.files}` : "";
    return { key: `${photo.noteId}-${file}`, noteId: photo.noteId, file, label: `${from}${side}` };
  }));
  return <dialog ref={dialogRef} className={`modal ${styles.photoDialog}`} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }}
    onPointerDown={event => { pressedOutside.current = onBackdrop(event); }}
    onClick={event => { const outside = pressedOutside.current && onBackdrop(event); pressedOutside.current = false; if (outside) close(); }}>
    <div className="dialog-header"><h2 id={titleId}>Photo ID<span className="muted"> · {name}</span></h2><button type="button" className="btn btn-quiet dialog-close" aria-label="Close" onClick={close}><span aria-hidden="true">×</span></button></div>
    <div className={`dialog-body ${styles.photoBody}`}>
      {frames.map(frame => <PhotoFrame key={frame.key} noteId={frame.noteId} file={frame.file} label={frame.label} />)}
      <p className={styles.photoNote}>Private: share it only with the hiring team. It is kept in HubSpot with the recruit.</p>
    </div>
  </dialog>;
}
