import type { FormEvent } from "react";

import type { LifeDiffView } from "../view-model";
import { BranchControls } from "./BranchControls";
import { LifeGitDiff } from "./LifeGitDiff";

interface LifeGitWorkspaceProps {
  readonly canCreateC1: boolean;
  readonly canRewind: boolean;
  readonly diff?: LifeDiffView;
  readonly housingAll: string;
  readonly isBranchPending: boolean;
  readonly onFork: (event: FormEvent<HTMLFormElement>) => void;
  readonly onHousingAllChange: (value: string) => void;
  readonly onRewind: () => void;
  readonly showBranchControls: boolean;
}

export function LifeGitWorkspace({
  canCreateC1,
  canRewind,
  diff,
  housingAll,
  isBranchPending,
  onFork,
  onHousingAllChange,
  onRewind,
  showBranchControls,
}: LifeGitWorkspaceProps) {
  return (
    <section aria-labelledby="life-git-workspace-heading" className="journey-shell life-git-workspace">
      <h1 id="life-git-workspace-heading">Ветка жилья</h1>
      {diff === undefined ? (
        <p>Изменений между C0 и C1 пока нет.</p>
      ) : <LifeGitDiff diff={diff} />}
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
