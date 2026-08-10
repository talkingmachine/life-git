import type { LifeDiffView } from "../view-model";
import { formatDecimal, formatSignedDecimal } from "../view-model";

interface LifeGitDiffProps {
  diff: LifeDiffView;
}

const reusedLabels = {
  profile: "профиль",
  evidence: "доказательства",
  rules: "правила",
} as const;

export function LifeGitDiff({ diff }: LifeGitDiffProps) {
  return (
    <section aria-labelledby="life-diff-heading" className="life-diff">
      <h2 id="life-diff-heading">Life Git: C0 → C1</h2>
      <p>
        Жильё: {formatDecimal(diff.housing.before)} → {formatDecimal(diff.housing.after)} · {formatSignedDecimal(diff.housing.delta)} ALL
      </p>
      <p>
        Известный остаток: {formatDecimal(diff.knownResidual.before)} → {formatDecimal(diff.knownResidual.after)} · {formatSignedDecimal(diff.knownResidual.delta)} ALL
      </p>
      <p>Причина изменения: жильё</p>
      <p>Переиспользовано: {diff.reused.map((item) => reusedLabels[item]).join(", ")}</p>
    </section>
  );
}
