"use client";

import { STAGE_PAGES } from "../lib/recruiting-config.mjs";
import { adjacentStageId, stageSnapshotAvailable } from "./recruit-stage-save.mjs";

type StageRecruit = { id: string; name: string; stageId: string; updatedAt: string | null; editValues?: Record<string, string> };
type Props = { recruit: StageRecruit; canEdit: boolean; disabled: boolean; onChange: (stageId: string) => void; mode: "select" | "arrows" };

function StageArrow({ direction }: { direction: "back" | "forward" }) {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {direction === "back" ? <path d="M12 19V5m-6 6 6-6 6 6" /> : <path d="M12 5v14m-6-6 6 6 6-6" />}
  </svg>;
}

export default function RecruitStageControls({ recruit, canEdit, disabled, onChange, mode }: Props) {
  const current = STAGE_PAGES.find(page => page.stageId === recruit.stageId);
  const available = canEdit && !disabled && stageSnapshotAvailable(recruit);
  if (mode === "select") return <select className="select stage-select" aria-label={`Lifecycle stage for ${recruit.name}`} value={recruit.stageId} disabled={!available}
    title={!canEdit ? "Stage changes are unavailable in this workspace." : !stageSnapshotAvailable(recruit) ? "Refresh this recruit before changing its stage." : "Choose a stage to save it to HubSpot."}
    onChange={event => { if (available && event.target.value !== recruit.stageId) onChange(event.target.value); }}>
    {!current && <option value={recruit.stageId}>Unrecognized stage</option>}
    {STAGE_PAGES.map(page => <option value={page.stageId} key={page.stageId}>{page.label}</option>)}
  </select>;
  return <div className="stage-arrows" role="group" aria-label={`Move ${recruit.name} between stages`}>
    {(["back", "forward"] as const).map(direction => {
      const target = adjacentStageId(recruit.stageId, direction);
      const page = STAGE_PAGES.find(item => item.stageId === target);
      const label = direction === "back" ? `Move ${recruit.name} back${page ? ` to ${page.label}` : " a stage"}` : `Advance ${recruit.name}${page ? ` to ${page.label}` : " a stage"}`;
      const reason = !current ? "Refresh this recruit before changing its stage." : !target ? direction === "back" ? "Already at the first stage." : "Already at the final stage." : direction === "back" ? `Move back to ${page?.label}. Saves to HubSpot.` : `Advance to ${page?.label}. Saves to HubSpot.`;
      return <button type="button" className="stage-arrow-button" key={direction} disabled={!available || !target} aria-label={label} title={reason}
        onClick={() => { if (available && target) onChange(target); }}><StageArrow direction={direction} /></button>;
    })}
  </div>;
}
