import type { FormEvent } from "react";

interface BranchControlsProps {
  readonly canCreateC1: boolean;
  readonly canRewind: boolean;
  readonly housingAll: string;
  readonly isBranchPending: boolean;
  readonly onFork: (event: FormEvent<HTMLFormElement>) => void;
  readonly onHousingAllChange: (value: string) => void;
  readonly onRewind: () => void;
}

export function BranchControls({
  canCreateC1,
  canRewind,
  housingAll,
  isBranchPending,
  onFork,
  onHousingAllChange,
  onRewind,
}: BranchControlsProps) {
  return (
    <section aria-labelledby="branch-controls-heading" className="branch-controls">
      <h2 id="branch-controls-heading">Управление веткой</h2>
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
  );
}
