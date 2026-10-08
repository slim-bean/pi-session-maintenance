import { decodeKittyPrintable, isKeyRelease, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { findRun, sessionText } from "./runs.ts";
import { renderRows, runRows, type Row } from "./presentation.ts";
export { safeText } from "./text.ts";
/** Passive screen: no scheduler holds, model calls, ownership claims or writes. */
export class RunViewer {
  private timer?: ReturnType<typeof setInterval>;
  private text = "";
  private rows: Row[] = [{ text: "Waiting for a maintenance run. Close and use /maintenance run to start one.", tone: "muted" }];
  private offset = 0;
  private follow = true;
  private requests = false;
  private thinking = false;
  private raw = false;
  private timing = "";
  private revision = "";
  private layout?: { width: number; text: string; lines: string[] };
  private disposed = false;
  constructor(private tui: { requestRender(): void; terminal?: { rows: number } }, private theme: Theme,
    private done: () => void, private stateDir: string, private cwd: string, private id?: string,
    private mode: "log" | "session" = "log") {
    this.follow = mode === "log";
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 500); this.timer.unref?.();
  }
  private refresh() {
    if (this.disposed) return;
    try {
      const run = findRun(this.stateDir, this.cwd, this.id);
      const revision = run ? `${run.file}:${run.revision}` : "";
      if (revision !== this.revision || !run) this.rows = run ? this.raw
        ? [{ text: sessionText(run, true, true, true) }]
        : runRows(run, { prompts: this.requests, thinking: this.thinking, session: this.mode === "session" })
        : [{ text: this.id ? "Run no longer available (it may have been pruned). Close and choose /maintenance history."
          : "Waiting for a maintenance run. Close and use /maintenance run to start one.", tone: "muted" }];
      const text = JSON.stringify(this.rows);
      this.revision = revision;
      const timing = run ? `elapsed ${Math.max(0, Math.floor(((run.ended ?? Date.now()) - run.started) / 1000))}s · last event ${Math.max(0, Math.floor((Date.now() - (run.lastEvent ?? run.started)) / 1000))}s ago` : "";
      if (text !== this.text || timing !== this.timing) { this.text = text; this.timing = timing; this.tui.requestRender(); }
    } catch (error) { this.rows = [{ label: "Transcript unavailable", text: (error as Error).message, tone: "error" }]; this.text = JSON.stringify(this.rows); this.tui.requestRender(); }
  }
  handleInput(data: string) {
    if (isKeyRelease(data)) return;
    const printable = decodeKittyPrintable(data) ?? data;
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || printable === "q") { this.dispose(); this.done(); return; }
    if (matchesKey(data, Key.up) || printable === "k") { this.follow = false; this.offset = Math.max(0, this.offset - 1); }
    else if (matchesKey(data, Key.down) || printable === "j") { this.follow = false; this.offset++; }
    else if (matchesKey(data, Key.pageUp)) { this.follow = false; this.offset = Math.max(0, this.offset - 10); }
    else if (matchesKey(data, Key.pageDown)) { this.follow = false; this.offset += 10; }
    else if (matchesKey(data, Key.home)) { this.follow = false; this.offset = 0; }
    else if (matchesKey(data, Key.end) || printable === "f") this.follow = true;
    else if (printable === "p") { this.requests = !this.requests; this.revision = ""; this.refresh(); }
    else if (printable === "t") { this.thinking = !this.thinking; this.revision = ""; this.refresh(); }
    else if (printable === "r") { this.raw = !this.raw; this.revision = ""; this.refresh(); }
    this.tui.requestRender();
  }
  render(width: number): string[] {
    const height = Math.max(3, Math.min(30, (this.tui.terminal?.rows ?? 24) - 5));
    if (this.layout?.width !== width || this.layout.text !== this.text) {
      this.layout = { width, text: this.text,
        lines: renderRows(this.rows, this.theme, width) };
    }
    const lines = this.layout.lines;
    const max = Math.max(0, lines.length - height);
    this.offset = this.follow ? max : Math.min(this.offset, max);
    const title = this.mode === "session" ? "Session (read-only) — ↑↓ scroll · p system · t thinking · r JSON · Esc back"
      : `Maintenance ${this.follow ? "FOLLOW" : "LOG"} — ↑↓ scroll · f follow · p prompts · t thinking · r JSON · Esc close`;
    return [truncateToWidth(this.theme.fg("accent", title), width),
      truncateToWidth(this.theme.fg("muted", this.timing), width),
      ...lines.slice(this.offset, this.offset + height).map(line => truncateToWidth(line, width))];
  }
  invalidate() { this.layout = undefined; this.tui.requestRender(); }
  dispose() { if (this.disposed) return; this.disposed = true; clearInterval(this.timer); this.timer = undefined; }
}
