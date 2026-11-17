// node:sqlite ships with Node 22.5+ (production runs Node 24), but @types/node here is v20. Just what the
// session index uses.
declare module 'node:sqlite' {
  type SQLValue = null | number | bigint | string | Uint8Array;
  interface StatementSync {
    run(...params: SQLValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: SQLValue[]): Record<string, SQLValue> | undefined;
    all(...params: SQLValue[]): Record<string, SQLValue>[];
    iterate(...params: SQLValue[]): IterableIterator<Record<string, SQLValue>>;
  }
  export class DatabaseSync {
    constructor(path: string, options?: { open?: boolean; readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

// zstd in node:zlib (Node 22.15+); @types/node v20 does not have it. Codex keeps finished rollouts as .jsonl.zst.
declare module 'zlib' {
  function createZstdDecompress(): import('stream').Transform;
  function zstdCompressSync(data: Buffer): Buffer;
}
