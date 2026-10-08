import { decodeKittyPrintable, isKeyRelease, Key, matchesKey, SelectList, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { listRuns, sessionText, type RunInfo } from "./runs.ts";
import { renderRows, runRows, statusStyle, type Row, type Tone } from "./presentation.ts";
import { RunViewer } from "./viewer.ts";
import { safeText } from "./text.ts";

/** Workspace-scoped passive history. Selection follows ID, never row position, so
 * incoming runs cannot steal focus. Opening a transcript does not replace pi's session. */
export class HistoryViewer {
  private runs: RunInfo[] = [];
  private list?: SelectList;
  private listKey = "";
  private selected?: string;
  private focus: "list" | "detail" = "list";
  private offset = 0;
  private follow = false;
  private text = "";
  private rows: Row[] = [{ text: "No maintenance history for this workspace yet.", tone: "muted" }];
  private raw = false;
  private thinking = false;
  private revision = "";
  private layout?: { width: number; text: string; lines: string[] };
  private child?: RunViewer;
  private timer?: ReturnType<typeof setInterval>;
  private disposed = false;
  constructor(private tui: { requestRender(): void; terminal?: { rows: number } }, private theme: Theme,
    private done: () => void, private stateDir: string, private cwd: string, id?: string) {
    this.selected = id; this.refresh();
    this.timer = setInterval(() => { if (!this.child) this.refresh(); }, 500); this.timer.unref?.();
  }
  private refresh() {
    if (this.disposed) return;
    try {
      this.runs = listRuns(this.stateDir, this.cwd);
      if (!this.runs.some(r => r.id === this.selected)) { this.selected = this.runs[0]?.id; this.offset = 0; this.follow = false; }
      const run = this.runs.find(r => r.id === this.selected);
      const revision = run ? `${run.id}:${run.revision}` : "empty";
      if (revision !== this.revision) {
        this.revision = revision;
        this.rows = run ? this.raw ? [{ text: sessionText(run, true, true, true) }] : runRows(run, { thinking: this.thinking })
          : [{ text: "No maintenance history for this workspace yet.", tone: "muted" }];
        this.text = JSON.stringify(this.rows);
      }
      this.tui.requestRender();
    } catch (error) { this.rows = [{ label: "History unavailable", text: (error as Error).message, tone: "error" }]; this.text = JSON.stringify(this.rows); this.tui.requestRender(); }
  }
  private ensureList(height: number) {
    const key = JSON.stringify([height, this.runs.map(r => [r.id, r.stage, r.status, r.started])]);
    if (this.list && key === this.listKey) return;
    this.listKey = key;
    const tones = new Map<string, Tone>();
    this.list = new SelectList(this.runs.map(r => {
      const style = statusStyle(r.status); const description = `${style.icon} ${style.text}`; tones.set(description, style.tone);
      return { value: r.id,
        label: safeText(`${new Date(r.started).toLocaleDateString()} ${new Date(r.started).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ${r.stage}`), description };
    }), height, {
      selectedPrefix: text => this.theme.fg("accent", text), selectedText: text => this.theme.fg("accent", text),
      description: text => this.theme.fg(tones.get(text) ?? "muted", text), scrollInfo: text => this.theme.fg("muted", text), noMatch: text => this.theme.fg("muted", text),
    });
    this.list.setSelectedIndex(Math.max(0, this.runs.findIndex(r => r.id === this.selected)));
    this.list.onSelectionChange = item => { this.selected = item.value; this.offset = 0; this.follow = false; this.revision = ""; this.refresh(); };
  }
  handleInput(data: string) {
    if (isKeyRelease(data)) return;
    if (this.child) { this.child.handleInput(data); return; }
    const key = decodeKittyPrintable(data) ?? data;
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || key === "q") { this.dispose(); this.done(); return; }
    if (matchesKey(data, Key.enter)) {
      if (!this.selected) return;
      this.child = new RunViewer(this.tui, this.theme, () => {
        this.child?.dispose(); this.child = undefined; this.refresh();
      }, this.stateDir, this.cwd, this.selected, "session");
      this.tui.requestRender(); return;
    }
    if (key === "r" || key === "t") {
      if (key === "r") this.raw = !this.raw; else this.thinking = !this.thinking;
      this.revision = ""; this.refresh();
    }
    else if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift("tab"))) this.focus = this.focus === "list" ? "detail" : "list";
    else if (matchesKey(data, Key.left) || key === "h") this.focus = "list";
    else if (matchesKey(data, Key.right) || key === "l") this.focus = "detail";
    else if (this.focus === "list") {
      this.ensureList(this.bodyHeight());
      const index = Math.max(0, this.runs.findIndex(run => run.id === this.selected));
      if (matchesKey(data, Key.home)) this.list?.setSelectedIndex(0);
      else if (matchesKey(data, Key.end)) this.list?.setSelectedIndex(Math.max(0, this.runs.length - 1));
      else if (matchesKey(data, Key.pageUp)) this.list?.setSelectedIndex(Math.max(0, index - this.bodyHeight()));
      else if (matchesKey(data, Key.pageDown)) this.list?.setSelectedIndex(Math.max(0, Math.min(this.runs.length - 1, index + this.bodyHeight())));
      else this.list?.handleInput(key === "j" ? "\x1b[B" : key === "k" ? "\x1b[A" : data);
    } else {
      if (matchesKey(data, Key.up) || key === "k") { this.follow = false; this.offset = Math.max(0, this.offset - 1); }
      else if (matchesKey(data, Key.down) || key === "j") { this.follow = false; this.offset++; }
      else if (matchesKey(data, Key.pageUp)) { this.follow = false; this.offset = Math.max(0, this.offset - this.bodyHeight()); }
      else if (matchesKey(data, Key.pageDown)) { this.follow = false; this.offset += this.bodyHeight(); }
      else if (matchesKey(data, Key.home)) { this.follow = false; this.offset = 0; }
      else if (matchesKey(data, Key.end) || key === "f") this.follow = true;
    }
    this.tui.requestRender();
  }
  private bodyHeight() { return Math.max(1, Math.min(35, (this.tui.terminal?.rows ?? 24) - 6)); }
  render(width: number): string[] {
    if (this.child) return this.child.render(width);
    const height = this.bodyHeight(); this.ensureList(height);
    const wide = width >= 64;
    const leftWidth = wide ? Math.min(44, Math.floor(width * .38)) : width;
    const rightWidth = wide ? width - leftWidth - 3 : width;
    if (this.layout?.width !== rightWidth || this.layout.text !== this.text) this.layout = { width: rightWidth, text: this.text,
      lines: renderRows(this.rows, this.theme, rightWidth) };
    const max = Math.max(0, this.layout.lines.length - height); this.offset = this.follow ? max : Math.min(this.offset, max);
    const detail = this.layout.lines.slice(this.offset, this.offset + height);
    const list = this.list!.render(leftWidth).slice(0, height);
    const title = this.theme.fg("accent", `Maintenance history (${this.runs.length}) — Enter session · Tab pane · Esc close`);
    const heading = this.theme.fg("muted", `${this.focus === "list" ? "▶ " : ""}Runs${wide ? " / " : " — "}${this.focus === "detail" ? "▶ " : ""}Logs & results`);
    const body = Array.from({ length: height }, (_, i) => {
      if (!wide) return truncateToWidth((this.focus === "list" ? list : detail)[i] ?? "", width);
      const left = truncateToWidth(list[i] ?? "", leftWidth);
      return left + " ".repeat(Math.max(0, leftWidth - visibleWidth(left))) + this.theme.fg("border", " │ ") + truncateToWidth(detail[i] ?? "", rightWidth);
    });
    return [truncateToWidth(title, width), truncateToWidth(heading, width), ...body,
      truncateToWidth(this.theme.fg("muted", `${this.focus === "list" ? "↑↓ select run" : "↑↓ scroll output · End/f follow"} · r JSON · t thinking · ←→ panes${wide ? "" : " (narrow: one pane at a time)"}`), width)];
  }
  invalidate() { this.layout = undefined; this.listKey = ""; this.child?.invalidate(); this.tui.requestRender(); }
  dispose() { if (this.disposed) return; this.disposed = true; clearInterval(this.timer); this.timer = undefined; this.child?.dispose(); this.child = undefined; }
}
