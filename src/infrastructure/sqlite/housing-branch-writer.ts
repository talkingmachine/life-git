import type Database from "better-sqlite3";

import type { BranchRunRevision, BranchRunRevisionPayload } from "../../application/contracts";
import type { HousingBranchAppendPort } from "../../application/fork-housing";
import type { BranchCommit } from "../../branch/life-git";
import { SqliteBranchStore } from "./branch-store";
import { SqliteRunStore } from "./run-store";

export class SqliteHousingBranchWriter implements HousingBranchAppendPort {
  constructor(
    private readonly database: Database.Database,
    private readonly branchStore: SqliteBranchStore,
    private readonly runStore: SqliteRunStore,
  ) {}

  append(commit: BranchCommit, revision: BranchRunRevisionPayload): BranchRunRevision {
    return this.database.transaction(() => {
      this.branchStore.append(commit);
      return this.runStore.appendBranch(revision);
    })();
  }
}
