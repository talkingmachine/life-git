"use client";

import { useState } from "react";

import type { EvidenceReadItem } from "../../application/contracts";
import {
  EVIDENCE_CLASS_NAMES,
  groupEvidenceItems,
} from "../view-model";
import type { EvidenceClassName } from "../view-model";
import { EvidencePassport } from "./EvidencePassport";

interface SourcesWorkspaceProps {
  readonly companionMode: "staged" | "none" | "separate";
  readonly items: readonly EvidenceReadItem[];
}

type EvidenceFilter = EvidenceClassName | "all";

const filterLabels: Readonly<Record<EvidenceClassName, string>> = Object.freeze({
  official_fact: "Официальный факт",
  user_fact: "Факт пользователя",
  calculation: "Расчёт",
  assumption: "Допущение",
  projection: "Проекция",
  unknown: "Неизвестно",
});

export function SourcesWorkspace({ companionMode, items }: SourcesWorkspaceProps) {
  const [filter, setFilter] = useState<EvidenceFilter>("official_fact");
  const grouped = groupEvidenceItems(items);
  const visibleClasses = filter === "all" ? EVIDENCE_CLASS_NAMES : [filter] as const;
  const visibleItems = filter === "all" ? items : grouped[filter];

  return (
    <section aria-labelledby="sources-workspace-heading" className="journey-shell sources-workspace">
      <h1 id="sources-workspace-heading">Паспорт доказательств</h1>
      <div aria-label="Фильтр классов доказательств" className="sources-workspace__filters" role="group">
        {EVIDENCE_CLASS_NAMES.map((className) => (
          <button
            aria-pressed={filter === className}
            key={className}
            onClick={() => setFilter(className)}
            type="button"
          >
            {filterLabels[className]}
          </button>
        ))}
        <button aria-pressed={filter === "all"} onClick={() => setFilter("all")} type="button">
          Все классы
        </button>
      </div>
      <EvidencePassport
        companionMode={companionMode}
        items={visibleItems}
        visibleClasses={visibleClasses}
      />
    </section>
  );
}
