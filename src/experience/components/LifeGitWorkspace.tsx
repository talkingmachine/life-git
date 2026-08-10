import type { LifeDiffView } from "../view-model";
import { LifeGitDiff } from "./LifeGitDiff";

interface LifeGitWorkspaceProps {
  readonly diff?: LifeDiffView;
}

export function LifeGitWorkspace({ diff }: LifeGitWorkspaceProps) {
  return (
    <section aria-labelledby="life-git-workspace-heading" className="journey-shell life-git-workspace">
      <h1 id="life-git-workspace-heading">Ветка жилья</h1>
      {diff === undefined ? (
        <p>Изменений между C0 и C1 пока нет.</p>
      ) : <LifeGitDiff diff={diff} />}
    </section>
  );
}
