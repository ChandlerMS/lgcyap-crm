"use client";

import { useId, useState, type FormEvent } from "react";
import { applyDemoDetails, DemoRecruitError, isDemoRecruit } from "./recruit-demo.mjs";
import styles from "./demo-recruit-editor.module.css";

type DemoEditableRecruit = { id: string; name: string; isDemo?: boolean; firstName?: string | null; lastName?: string | null; phone?: string | null; email?: string | null; recruiter?: string | null };
type Props<T extends DemoEditableRecruit> = { recruit: T; onSave: (recruit: T) => void; onClose: () => void };
type Draft = { firstName: string; lastName: string; phone: string; email: string; recruiter: string };
const FIELDS: { key: keyof Draft; label: string; type?: string; maxLength: number }[] = [
  { key: "firstName", label: "First name", maxLength: 100 }, { key: "lastName", label: "Last name", maxLength: 100 },
  { key: "phone", label: "Phone number", type: "tel", maxLength: 80 }, { key: "email", label: "Email", type: "email", maxLength: 254 },
  { key: "recruiter", label: "Recruiter", maxLength: 100 },
];

export default function DemoRecruitEditor<T extends DemoEditableRecruit>({ recruit, onSave, onClose }: Props<T>) {
  const id = useId();
  const [draft, setDraft] = useState<Draft>({ firstName: recruit.firstName ?? "", lastName: recruit.lastName ?? "", phone: recruit.phone ?? "", email: recruit.email ?? "", recruiter: recruit.recruiter ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const allowed = isDemoRecruit(recruit);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allowed) return;
    try {
      const updated = applyDemoDetails(recruit, draft, Date.now()) as T;
      setErrors({}); setNotice(""); onSave(updated); onClose();
    } catch (error) {
      setErrors(error instanceof DemoRecruitError ? error.fieldErrors as Record<string, string> : {});
      setNotice(error instanceof Error ? error.message : "The sample could not be updated.");
    }
  }
  return <section className={styles.editor} aria-labelledby={`${id}-title`}>
    <div className={styles.heading}><h2 id={`${id}-title`}>Edit demo recruit</h2><button type="button" className="btn btn-quiet" onClick={onClose} aria-label="Close demo editor">×</button></div>
    <p className={styles.banner}>Demo changes stay in this app. They never sync to HubSpot.</p>
    {!allowed && <p role="alert" className={styles.error}>This record is outside the isolated demo. Close this editor.</p>}
    {notice && <p role="alert" className={styles.error}>{notice}</p>}
    <form onSubmit={submit} noValidate>
      <div className={styles.fields}>{FIELDS.map(field => <label key={field.key} htmlFor={`${id}-${field.key}`}><span>{field.label}</span><input id={`${id}-${field.key}`} type={field.type ?? "text"} value={draft[field.key]} maxLength={field.maxLength} autoComplete="off" disabled={!allowed} required={field.key !== "recruiter"} aria-invalid={Boolean(errors[field.key])} aria-describedby={errors[field.key] ? `${id}-${field.key}-error` : undefined} onChange={event => { setDraft(value => ({ ...value, [field.key]: event.target.value })); setErrors(value => ({ ...value, [field.key]: "" })); }} />{errors[field.key] && <small id={`${id}-${field.key}-error`} className={styles.error}>{errors[field.key]}</small>}</label>)}</div>
      <div className={styles.actions}><button className="btn btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" type="submit" disabled={!allowed}>Save demo changes</button></div>
    </form>
  </section>;
}
