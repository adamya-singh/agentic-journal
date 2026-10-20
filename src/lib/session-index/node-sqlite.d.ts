// node:sqlite ships with Node 22.5+ (production runs Node 24), but @types/node here is v20. Just what the
// session index uses.
declare module 'node:sqlite' {
  type SQLValue = null | number | bigint | string | Uint8Array;
  interface StatementSync {
    run(...params: SQLValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: SQLValue[]): Record<string, SQLValue> | undefined;
    all(...params: SQLValue[]): Record<string, SQLValue>[];
  }
  export class DatabaseSync {
    constructor(path: string, options?: { open?: boolean; readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
