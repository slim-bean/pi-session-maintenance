import { decodeKittyPrintable, isKeyRelease, Key, matchesKey } from "@earendil-works/pi-tui";
const commands = ["watch", "history", "logs", "status", "help", "run", "retry"];
/** Only maintenance inspection/admission commands can be typed without preempting a run.
 * Ordinary prose, other slash commands, paste with newlines, and mutation commands
 * still take foreground priority. Focused monitor navigation is handled separately. */
export function passiveCommand(text: string): boolean {
  if (/[\r\n]/.test(text)) return false;
  return /^\/memory-upgrade[ \t]+status[ \t]*$/.test(text) || /^\/maintenance(?:\s+(?:watch|history|logs|status|help|run|retry)(?:\s+[^\r\n]*)?)?\s*$/.test(text);
}
const prefixes = [...commands.map(command => `/maintenance ${command}`), "/memory-upgrade status"];
function passiveDraft(text: string): boolean {
  if (!text.startsWith("/") || /[\r\n]/.test(text)) return false;
  const candidate = text.replace(/[ \t]+/g, " "); // command args accept repeated whitespace
  return prefixes.some(prefix => prefix.startsWith(candidate)) || passiveCommand(candidate);
}
export function passiveTerminalInput(editor: string, data: string): boolean {
  if (isKeyRelease(data) || data === "\x1b[I" || data === "\x1b[O") return true;
  // Up/Down navigate editor history before getEditorText reflects the recalled entry.
  // Browsing is not submission. Enter below still checks what was actually recalled.
  if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) return true;
  if (matchesKey(data, "ctrl+alt+m")) return true;
  if (data.startsWith("\x1b[200~") && data.endsWith("\x1b[201~")) return passiveDraft(editor + data.slice(6, -6));
  if (matchesKey(data, Key.enter)) return passiveCommand(editor);
  const printable = decodeKittyPrintable(data) ?? (/^[^\x00-\x1f\x7f]+$/.test(data) ? data : "");
  return passiveDraft(editor + printable);
}
