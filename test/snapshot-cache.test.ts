import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, statSync, utimesSync, renameSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SnapshotCache } from "../src/snapshot-cache.ts";
import { snapshot } from "../src/source.ts";

test("unchanged snapshots are shared and immutable; edits/replacement invalidate even at restored mtime", async () => {
  const dir = mkdtempSync(join(tmpdir(), "snapshot-cache-"));
  const file = join(dir, "session.jsonl");
  const raw = (text: string) => JSON.stringify({type:"session",id:"fixture",cwd:dir}) + "\n" +
    JSON.stringify({type:"message",id:"a",message:{role:"user",content:text}}) + "\n";
  const cache = new SnapshotCache();
  try {
    writeFileSync(file, raw("first"));
    const a = await cache.read(file);
    assert.deepEqual(a, snapshot(file));
    assert.equal(await cache.read(file), a);
    assert.throws(() => a.entries.push(a.entries[0]!));
    assert.throws(() => { a.entries[0]!.text = "contaminated"; });
    const before = statSync(file);
    writeFileSync(file, raw("other")); utimesSync(file, before.atime, before.mtime);
    const b = await cache.read(file);
    assert.notEqual(b.hash, a.hash); assert.equal(b.entries[0]!.text, "other");
    const replacement = file + ".new";
    writeFileSync(replacement, raw("third")); renameSync(replacement, file);
    assert.equal((await cache.read(file)).entries[0]!.text, "third");
    writeFileSync(file, "{broken");
    await assert.rejects(cache.read(file));
    writeFileSync(file, raw("fixed"));
    assert.equal((await cache.read(file)).entries[0]!.text, "fixed");
    cache.clear(); assert.equal(cache.size, 0);
    truncateSync(file, 128 * 1024 * 1024 + 1);
    await assert.rejects(cache.read(file), /128MiB/);
  } finally { rmSync(dir, {recursive:true,force:true}); }
});
test("cache is bounded by entry count and serialized size", async () => {
  const dir = mkdtempSync(join(tmpdir(), "snapshot-budget-"));
  try {
    const cache = new SnapshotCache(4096, 2);
    for (let i=0;i<3;i++) {
      const file = join(dir, i+".jsonl");
      writeFileSync(file, JSON.stringify({type:"session",id:String(i),cwd:dir})+"\n");
      await cache.read(file);
    }
    assert.equal(cache.size, 2);
    const noCache = new SnapshotCache(0);
    await noCache.read(join(dir,"0.jsonl")); assert.equal(noCache.size, 0);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
