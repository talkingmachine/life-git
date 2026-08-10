import type { FormEvent } from "react";

import type { BudgetView } from "../view-model";
import { LifeBranch } from "./LifeBranch";
import { ProfileCard } from "./ProfileCard";
import type { ProfileCardData } from "./ProfileCard";

interface BranchWorkspaceProps {
  readonly budget?: BudgetView;
  readonly canCreateC1: boolean;
  readonly canRewind: boolean;
  readonly canSaveC0: boolean;
  readonly housingAll: string;
  readonly isBranchPending: boolean;
  readonly onFork: (event: FormEvent<HTMLFormElement>) => void;
  readonly onHousingAllChange: (value: string) => void;
  readonly onRewind: () => void;
  readonly onSaveC0: () => void;
  readonly profile: ProfileCardData;
  readonly showBranchControls: boolean;
}

export function BranchWorkspace({
  budget,
  canCreateC1,
  canRewind,
  canSaveC0,
  housingAll,
  isBranchPending,
  onFork,
  onHousingAllChange,
  onRewind,
  onSaveC0,
  profile,
  showBranchControls,
}: BranchWorkspaceProps) {
  return (
    <section aria-label="Моя ветвь" className="journey-shell branch-workspace">
      <ProfileCard canSaveC0={canSaveC0} onSaveC0={onSaveC0} profile={profile} />
      {budget === undefined ? null : <LifeBranch budget={budget} />}
      {showBranchControls ? (
        <section aria-labelledby="branch-controls-heading" className="branch-controls">
          <h2 id="branch-controls-heading">Ветка жилья</h2>
          <button disabled={!canRewind || isBranchPending} onClick={onRewind} type="button">
            Перемотать к C0
          </button>
          <form onSubmit={onFork}>
            <label htmlFor="housing-all">Жильё для C1, ALL</label>
            <input
              id="housing-all"
              inputMode="decimal"
              onChange={(event) => onHousingAllChange(event.currentTarget.value)}
              value={housingAll}
            />
            <button disabled={!canCreateC1 || isBranchPending} type="submit">
              Создать C1
            </button>
          </form>
        </section>
      ) : null}
    </section>
  );
}
