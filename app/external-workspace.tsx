import { externalWorkspacePage } from './external-workspace-pages.mjs';

export default function ExternalWorkspace({ view }: { view: string }) {
  const page = externalWorkspacePage(view);
  if (!page) return null;
  return <section className="external-workspace" aria-labelledby="page-title">
    <div className="page-head"><div><h1 id="page-title" className="page-title" tabIndex={-1}>{page.label}</h1><p className="subheading">{page.detail}</p></div><a className="btn btn-secondary" href={page.url} target="_blank" rel="noopener noreferrer">Open in new tab<span className="sr-only"> · {page.label}</span></a></div>
    <p className="helper">If this service requires sign-in or blocks embedded pages, use Open in new tab.</p>
    <iframe key={page.id} className="policytek-frame" src={page.url} title={`${page.label} · ${page.detail}`} referrerPolicy="no-referrer" />
  </section>;
}
