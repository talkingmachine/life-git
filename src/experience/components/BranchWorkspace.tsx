import type { FormEvent } from "react";

import type { BudgetView } from "../view-model";
import { BranchControls } from "./BranchControls";
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
        <BranchControls
          canCreateC1={canCreateC1}
          canRewind={canRewind}
          housingAll={housingAll}
          isBranchPending={isBranchPending}
          onFork={onFork}
          onHousingAllChange={onHousingAllChange}
          onRewind={onRewind}
        />
      ) : null}
    </section>
  );
}
