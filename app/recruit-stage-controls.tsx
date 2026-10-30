"use client";

import { FLOW_STAGES, LICENSE_ROUTES } from "../lib/recruiting-flow.mjs";
import { stageTransitionChoices, stageSnapshotAvailable } from "./recruit-stage-save.mjs";

export type StageFlowChanges = { licensing_branch?: "licensed" | "not_licensed" };
type StageRecruit = { id: string; name: string; stageId: string; stageKey?: string; recruitingPath?: string; licenseRoute?: string; updatedAt: string | null; editValues?: Record<string, string> };
type Props = { recruit: StageRecruit; canEdit: boolean; disabled: boolean; onChange: (stageId: string, flowChanges?: StageFlowChanges) => void; mode: "select" | "arrows" };
type Choice = ReturnType<typeof stageTransitionChoices>[number];
const optionValue = (choice: Choice) => JSON.stringify([choice.stageId, choice.licenseRoute ?? ""]);
function choiceLabel(choice: Choice) {
  return choice.licenseRoute && Object.hasOwn(LICENSE_ROUTES, choice.licenseRoute)
    ? `${choice.label} · ${LICENSE_ROUTES[choice.licenseRoute as keyof typeof LICENSE_ROUTES]}` : choice.label;
}

function StageArrow({ direction }: { direction: "back" | "forward" }) {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {direction === "back" ? <path d="M12 19V5m-6 6 6-6 6 6" /> : <path d="M12 5v14m-6-6 6 6 6-6" />}
  </svg>;
}

export default function RecruitStageControls({ recruit, canEdit, disabled, onChange, mode }: Props) {
  const current = FLOW_STAGES.find(stage => stage.key === recruit.stageKey);
  const snapshot = stageSnapshotAvailable(recruit);
  const available = canEdit && !disabled && snapshot;
  const back = stageTransitionChoices(recruit, "back"), forward = stageTransitionChoices(recruit, "forward");
  const unavailable = !canEdit ? "Stage changes are unavailable in this workspace." : !snapshot ? "Refresh this recruit before changing its stage." : "A save is in progress. Wait before choosing another step.";
  const choose = (choices: Choice[], value: string) => {
    const choice = choices.find(item => optionValue(item) === value);
    if (available && choice) onChange(choice.stageId, choice.flowChanges);
  };
  if (mode === "select") return <select className="select stage-select" aria-label={`Lifecycle stage for ${recruit.name}`} value="current" disabled={!available || !back.length && !forward.length}
    title={!available ? unavailable : "Choose a connected step to save it to HubSpot."}
    onChange={event => choose([...back, ...forward], event.target.value)}>
    <option value="current">{current?.label ?? "Unrecognized stage"}</option>
    {back.length > 0 && <optgroup label="Back">{back.map(choice => <option value={optionValue(choice)} key={optionValue(choice)}>{choiceLabel(choice)}</option>)}</optgroup>}
    {forward.length > 0 && <optgroup label="Next">{forward.map(choice => <option value={optionValue(choice)} key={optionValue(choice)}>{choiceLabel(choice)}</option>)}</optgroup>}
  </select>;
  return <div className="stage-arrows" role="group" aria-label={`Move ${recruit.name} between stages`}>
    {(["back", "forward"] as const).map(direction => {
      const choices = direction === "back" ? back : forward;
      const single = choices.length === 1 ? choices[0] : undefined;
      const label = direction === "back" ? `Move ${recruit.name} back${single ? ` to ${choiceLabel(single)}` : " a step"}` : `Advance ${recruit.name}${single ? ` to ${choiceLabel(single)}` : " a step"}`;
      const reason = !available ? unavailable : !choices.length ? !recruit.recruitingPath && ["hiring-event", "phone-interview", "offer"].includes(recruit.stageKey ?? "") ? "Choose this recruit’s path in the profile before this move." : "There is no connected step in this direction." : `${direction === "back" ? "Move back" : "Advance"} to ${single ? choiceLabel(single) : "a chosen step"}. Saves to HubSpot.`;
      if (choices.length > 1) return <select className="select stage-select" style={{ minWidth: 102, width: 136, maxWidth: 170 }} key={direction}
        aria-label={`${direction === "back" ? "Choose previous step" : "Choose next step"} for ${recruit.name}`} title={reason} value="" disabled={!available}
        onChange={event => choose(choices, event.target.value)}>
        <option value="" disabled>{direction === "back" ? "Back…" : "Next…"}</option>
        {choices.map(choice => <option value={optionValue(choice)} key={optionValue(choice)}>{choiceLabel(choice)}</option>)}
      </select>;
      return <button type="button" className="stage-arrow-button" key={direction} disabled={!available || !single} aria-label={label} title={reason}
        onClick={() => { if (available && single) onChange(single.stageId, single.flowChanges); }}><StageArrow direction={direction} /></button>;
    })}
  </div>;
}
