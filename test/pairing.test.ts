import assert from "node:assert/strict";
import { test } from "node:test";
import { unresolvedTools } from "../src/pairing.ts";

test("pairing respects compaction, reused IDs and aborted calls", () => {
  const call = (entry: string, id: string, stopReason = "toolUse"): any => ({ type: "message", id: entry,
    message: { role: "assistant", stopReason, content: [{ type: "toolCall", id, name: "read", arguments: {} }] } });
  const result = (entry: string, id: string): any => ({ type: "message", id: entry, message: { role: "toolResult", toolCallId: id } });
  assert.equal(unresolvedTools([call("a", "x")]), true);
  assert.equal(unresolvedTools([call("a", "x|extra"), result("b", "x")]), false);
  assert.equal(unresolvedTools([call("a", "x"), result("b", "x"), call("c", "x")]), true);
  assert.equal(unresolvedTools([call("a", "x", "aborted")]), false);
  assert.equal(unresolvedTools([call("a", "x"), { type: "compaction", id: "b", firstKeptEntryId: "b" } as any]), false);
  assert.throws(() => unresolvedTools([{ type: "compaction", id: "b", firstKeptEntryId: "missing" } as any]), /boundary/);
});
