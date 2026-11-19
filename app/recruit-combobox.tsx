"use client";
import { useId, useState, type KeyboardEvent } from "react";

export type ComboRecruit = { id: string; name: string; email?: string | null; stage?: string | null };
const LIMIT = 50;

/** Recruits whose name or email contains the typed text, by name; everyone when nothing is typed. */
export function matchRecruits<T extends ComboRecruit>(recruits: readonly T[], query: string): T[] {
  const typed = query.trim().toLowerCase();
  return recruits.filter(recruit => !typed || recruit.name.toLowerCase().includes(typed) || (recruit.email ?? "").toLowerCase().includes(typed))
    .sort((a, b) => a.name.localeCompare(b.name, "en-US", { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

/**
 * One Recruit field for New Email: typing filters the list beneath it to the matching recruits, and a click, or the
 * arrow keys and Enter, chooses one. Escape closes the list without closing the email. query is the box's text and
 * selectedId the chosen recruit; typing after a choice clears it (onQuery), and choosing calls onSelect.
 */
export default function RecruitCombobox({ recruits, query, selectedId, onQuery, onSelect }: { recruits: readonly ComboRecruit[]; query: string; selectedId: string; onQuery: (text: string) => void; onSelect: (recruit: ComboRecruit) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matches = matchRecruits(recruits, query);
  const shown = matches.slice(0, LIMIT);
  const current = Math.min(active, Math.max(0, shown.length - 1));
  const choose = (recruit: ComboRecruit) => { onSelect(recruit); setOpen(false); };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); if (open) setActive(Math.min(current + 1, shown.length - 1)); else { setOpen(true); setActive(0); } }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(Math.max(current - 1, 0)); }
    else if (event.key === "Enter" && open && shown[current]) { event.preventDefault(); choose(shown[current]); }
    else if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
  };
  const optionId = (recruit: ComboRecruit) => `${id}-option-${recruit.id}`;
  return <div className="recruit-combobox">
    <label htmlFor={`${id}-input`}>Recruit</label>
    <input id={`${id}-input`} type="text" role="combobox" autoComplete="off" spellCheck={false} aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`}
      aria-activedescendant={open && shown[current] ? optionId(shown[current]) : undefined} placeholder="Type a recruit's name" value={query}
      onChange={event => { onQuery(event.target.value); setOpen(true); setActive(0); }} onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={keyDown} />
    {open && <ul id={`${id}-list`} role="listbox" aria-label="Matching recruits" className="recruit-combobox-list">
      {shown.length ? shown.map((recruit, index) => <li key={recruit.id} id={optionId(recruit)} role="option" aria-selected={recruit.id === selectedId} className={index === current ? "is-active" : undefined}
        onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(recruit)}>
        <span>{recruit.name}</span>{(recruit.stage || recruit.email) && <small>{[recruit.stage, recruit.email].filter(Boolean).join(" · ")}</small>}
      </li>) : <li role="presentation" className="recruit-combobox-empty">{query.trim() ? `No recruit matches “${query.trim()}”.` : "No recruits are loaded."}</li>}
    </ul>}
    {open && matches.length > LIMIT && <p className="helper">Showing {LIMIT} of {matches.length} recruits. Keep typing to narrow the list.</p>}
  </div>;
}
