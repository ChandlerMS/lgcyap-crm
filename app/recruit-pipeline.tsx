import styles from "./recruit-pipeline.module.css";

export type PipelineRecruit = { id: string; name?: string; stageId?: string; stageKey?: string; recruitingPath?: string | null; licenseRoute?: string | null };
export type PipelineStage = { id: string; key?: string; stageId?: string; label: string };
type Props = { records: readonly PipelineRecruit[]; stages: readonly PipelineStage[]; partial?: boolean };
type Key = "hiring-event" | "application" | "phone-interview" | "offer" | "licensing-reminders" | "licensed-npn" | "contracting" | "training" | "completed" | "withdrawn";
type Item = { recruit: PipelineRecruit; key: string };
const LABELS: Record<Key, string> = {
  "hiring-event": "Hiring Event", application: "Application", "phone-interview": "Phone Interview", offer: "Offer",
  "licensing-reminders": "Licensing Reminders", "licensed-npn": "Licensed w/ NPN", contracting: "Contracting", training: "Training", completed: "Completed", withdrawn: "Withdrawn",
};
const PRE_OFFER = new Set<string>(["hiring-event", "application", "phone-interview"]);
const KNOWN = new Set<string>(Object.keys(LABELS));
function canonicalKey(value: string | undefined) {
  const key = String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  return key === "licensed-with-npn" ? "licensed-npn" : key;
}
function profileHref(record: PipelineRecruit) {
  return typeof record.id === "string" && /^[1-9]\d{0,29}$/.test(record.id) ? `#recruit/${encodeURIComponent(record.id)}` : undefined;
}
function RecruitLinks({ records }: { records: readonly PipelineRecruit[] }) {
  return <ul className={styles.recruitLinks}>{records.map((record, index) => <li key={`${record.id}-${index}`}>{profileHref(record) ? <a href={profileHref(record)}>{record.name || `Recruit ${record.id}`}</a> : <span>{record.name || "Recruit"}</span>}</li>)}</ul>;
}

function StageCard({ title, recruits }: { title: string; recruits: readonly PipelineRecruit[] }) {
  return <article className={`${styles.stage} ${recruits.length ? styles.occupied : ""}`} aria-label={`${title}: ${recruits.length} recruit${recruits.length === 1 ? "" : "s"}`}>
    <h4>{title}</h4><p className={styles.count}>{recruits.length}</p>
    {recruits.length ? <details className={styles.details}><summary>View recruits</summary><RecruitLinks records={recruits} /></details> : <p className={styles.empty}>No recruits</p>}
  </article>;
}

/** Current-stage counts only: paths split before Offer and shared stages count once. */
export default function RecruitPipeline({ records, stages, partial = false }: Props) {
  const unique = [...new Map(records.map(record => [record.id, record])).values()];
  const items: Item[] = unique.map(recruit => {
    const stage = stages.find(item => item.stageId && item.stageId === recruit.stageId);
    return { recruit, key: canonicalKey(stage ? stage.key ?? stage.id : recruit.stageKey) };
  });
  const label = (key: Key) => stages.find(stage => canonicalKey(stage.key ?? stage.id) === key)?.label ?? LABELS[key];
  const inStage = (key: Key) => items.filter(item => item.key === key).map(item => item.recruit);
  const inPath = (path: string) => unique.filter(record => record.recruitingPath === path);
  const unassignedPath = unique.filter(record => !["genpop", "mass_recruiting"].includes(record.recruitingPath ?? ""));
  const unassignedPreOffer = items.filter(item => PRE_OFFER.has(item.key) && !["genpop", "mass_recruiting"].includes(item.recruit.recruitingPath ?? ""));
  const unrecognized = items.filter(item => !KNOWN.has(item.key));
  const offer = inStage("offer");
  const licenseUnknown = offer.filter(record => !["licensed", "not_licensed"].includes(record.licenseRoute ?? ""));
  const reviewRecords = [...new Map([...unassignedPath, ...unrecognized.map(item => item.recruit), ...licenseUnknown].map(record => [record.id, record])).values()];

  const card = (key: Key, path?: string) => <StageCard title={label(key)} recruits={inStage(key).filter(record => !path || record.recruitingPath === path)} />;
  const arrow = <span className={styles.arrow} aria-hidden="true">→</span>;

  return <section className={styles.pipeline} aria-labelledby="recruit-pipeline-title">
    <div className={styles.heading}><div><h2 id="recruit-pipeline-title">Recruiting pipeline</h2><p>Current stage counts{partial ? " for the loaded records" : ""}. GenPop and Mass Recruiting meet at Offer.</p></div><p className={styles.total}><strong>{unique.length}</strong><span>{partial ? "Loaded recruits" : "Total recruits"}</span></p></div>
    <dl className={styles.stageTotals} aria-label="Current totals for every recruiting stage">{(Object.keys(LABELS) as Key[]).map(key => <div key={key}><dt>{label(key)}</dt><dd>{inStage(key).length}</dd></div>)}</dl>
    <dl className={styles.pathTotals}><div><dt>GenPop</dt><dd>{inPath("genpop").length}</dd></div><div><dt>Mass Recruiting</dt><dd>{inPath("mass_recruiting").length}</dd></div><div><dt>Path not recorded</dt><dd>{unassignedPath.length}</dd></div></dl>
    <div className={styles.scroll} role="region" aria-label="Recruiting paths and stage counts; scroll horizontally for the complete pipeline" tabIndex={0}>
      <div className={styles.flow}>
        <div className={styles.entryPaths}>
          <section className={styles.entryPath} aria-label="GenPop recruiting path"><h3>GenPop</h3><div className={styles.stageRow}>{card("hiring-event", "genpop")}{arrow}{card("application", "genpop")}{arrow}{card("phone-interview", "genpop")}</div></section>
          <section className={styles.entryPath} aria-label="Mass Recruiting path"><h3>Mass Recruiting</h3><div className={styles.stageRow}>{card("application", "mass_recruiting")}{arrow}{card("phone-interview", "mass_recruiting")}{arrow}{card("hiring-event", "mass_recruiting")}</div></section>
        </div>
        <span className={styles.merge} aria-hidden="true" />
        <div className={styles.sharedStage}>{card("offer")}<p className={styles.routeNote}>{licenseUnknown.length > 0 ? `${licenseUnknown.length} need a license-route choice` : "Both recruiting paths"}</p></div>
        {arrow}
        <div className={styles.licensePaths}>
          <div className={styles.directRoute}><h3>Licensed</h3><p>{offer.filter(record => record.licenseRoute === "licensed").length} currently at Offer</p><span aria-hidden="true">Direct to Contracting →</span></div>
          <div className={styles.licensingRoute}><h3>Not Licensed</h3><p className={styles.routeCount}>{offer.filter(record => record.licenseRoute === "not_licensed").length} currently at Offer</p><div className={styles.stageRow}>{card("licensing-reminders")}{arrow}{card("licensed-npn")}</div></div>
        </div>
        <span className={styles.merge} aria-hidden="true" />
        {card("contracting")}{arrow}{card("training")}
        <span className={styles.split} aria-hidden="true" />
        <div className={styles.outcomes}>{card("completed")}{card("withdrawn")}</div>
      </div>
    </div>
    <p className={styles.caption}>Counts show where recruits are now, rather than the number who have passed through a stage. Open a card to view its recruits.</p>
    {(unassignedPreOffer.length > 0 || unrecognized.length > 0 || reviewRecords.length > 0) && <aside className={styles.unassigned} aria-label="Records needing path or stage review"><h3>Records needing review <span>{reviewRecords.length}</span></h3>
      <p>Legacy records with an unrecorded path stay in the total. Their path and license route are not inferred.</p>
      {unassignedPreOffer.length > 0 && <dl className={styles.unassignedStages}>{(["hiring-event", "application", "phone-interview"] as const).map(key => <div key={key}><dt>{label(key)}, path not recorded</dt><dd>{unassignedPreOffer.filter(item => item.key === key).length}</dd></div>)}</dl>}
      {unrecognized.length > 0 && <p>{unrecognized.length} record{unrecognized.length === 1 ? " has" : "s have"} an unrecognized stage.</p>}
      <details className={styles.details}><summary>View records needing review</summary><RecruitLinks records={reviewRecords} /></details>
    </aside>}
  </section>;
}
