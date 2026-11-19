import { externalWorkspacePage } from './external-workspace-pages.mjs';

export default function ExternalWorkspace({ view }: { view: string }) {
  const page = externalWorkspacePage(view);
  if (!page) return null;
  const largeFrame = ["contracting-portal", "lead-payments", "knowledge-center"].includes(page.id);
  const frame = <iframe key={page.id} className={largeFrame ? "shopper-embed-frame" : "policytek-frame"} src={page.url} title={`${page.label} · ${page.detail}`} referrerPolicy="no-referrer" allow={page.id === "google-meet" ? "camera; microphone; display-capture; fullscreen; autoplay" : undefined} />;
  return <section className="external-workspace" aria-labelledby="page-title">
    <div className="page-head"><div><h1 id="page-title" className="page-title" tabIndex={-1}>{page.label}</h1><p className="subheading">{page.detail}</p></div><a className="btn btn-secondary" href={page.url} target="_blank" rel="noopener noreferrer">Open in new tab<span className="sr-only"> · {page.label}</span></a></div>
    <p className="helper">If this service requires sign-in or blocks embedded pages, use Open in new tab.</p>
    {largeFrame ? <div className={`shopper-embed${page.id === "lead-payments" ? " lead-payments-embed" : page.id === "knowledge-center" ? " knowledge-center-embed" : ""}`}>{frame}</div> : frame}
  </section>;
}
