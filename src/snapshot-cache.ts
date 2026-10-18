import { realpath, readFile, stat } from "node:fs/promises";
import { parseSnapshot, type Snapshot } from "./source.ts";

/** Read-only discovery cache, never used by mutation/source-freshness guards. */
export class SnapshotCache {
  private entries = new Map<string, { fingerprint: string; value: Snapshot; bytes: number }>();
  private bytes = 0;
  private generation = 0;
  constructor(private maxBytes = 8 * 1024 * 1024, private maxEntries = 16) {}
  clear() { this.generation++; this.entries.clear(); this.bytes = 0; }
  get size() { return this.entries.size; }

  async read(input: string): Promise<Snapshot> {
    const generation = this.generation;
    const path = await realpath(input);
    const fingerprint = async () => {
      const s = await stat(path, { bigint: true });
      if (!s.isFile()) throw new Error("Conversation source is not a file");
      if (s.size > 128n * 1024n * 1024n) throw new Error("Session exceeds the 128MiB source budget");
      return [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(":");
    };
    const before = await fingerprint();
    const old = this.entries.get(path);
    if (old?.fingerprint === before) {
      this.entries.delete(path); this.entries.set(path, old);
      return old.value;
    }
    if (old) { this.bytes -= old.bytes; this.entries.delete(path); }
    const value = parseSnapshot(path, await readFile(path, "utf8"));
    if (before !== await fingerprint() || path !== await realpath(input)) {
      throw new Error("Source changed while reading a snapshot; retry after the writer settles");
    }
    // Requests expose immutable source history to adapters; accidental edits
    // must not contaminate a later read of an unchanged file.
    for (const entry of value.entries) Object.freeze(entry);
    Object.freeze(value.entries); Object.freeze(value);
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (generation === this.generation && bytes <= this.maxBytes && this.maxEntries > 0) {
      while (this.entries.size && (this.bytes + bytes > this.maxBytes || this.entries.size >= this.maxEntries)) {
        const key = this.entries.keys().next().value!;
        this.bytes -= this.entries.get(key)!.bytes; this.entries.delete(key);
      }
      this.entries.set(path, { fingerprint: before, value, bytes }); this.bytes += bytes;
    }
    return value;
  }
}
