import type Database from "better-sqlite3";
import type { CityContinuationUnitOfWorkPort } from "../../application/city-source-recovery";

export type { CityContinuationUnitOfWorkPort } from "../../application/city-source-recovery";

/** The one immediate transaction shared by city continuation participants. */
export class SqliteCityContinuationUnitOfWork implements CityContinuationUnitOfWorkPort {
  constructor(private readonly database: Database.Database) {}

  run<T>(operation: () => T): T {
    return this.database.transaction(operation).immediate();
  }
}
