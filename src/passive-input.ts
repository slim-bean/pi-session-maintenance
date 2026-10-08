import { decodeKittyPrintable, isKeyRelease, Key, matchesKey } from "@earendil-works/pi-tui";
const commands = ["watch", "history", "logs", "status", "help", "run", "retry"];
/** Only maintenance inspection/admission commands can be typed without preempting a run.
 * Ordinary prose, other slash commands, paste with newlines, and mutation commands
 * still take foreground priority. Focused monitor navigation is handled separately. */
export function passiveCommand(text: string): boolean {
  if (/[\r\n]/.test(text)) return false;
  return /^\/maintenance(?:\s+(?:watch|history|logs|status|help|run|retry)(?:\s+[^\r\n]*)?)?\s*$/.test(text);
}
export function passiveTerminalInput(editor: string, data: string): boolean {
  if (isKeyRelease(data) || data === "\x1b[I" || data === "\x1b[O") return true;
  if (matchesKey(data, "ctrl+alt+m")) return true;
  if (data.startsWith("\x1b[200~") && data.endsWith("\x1b[201~")) return passiveCommand(editor + data.slice(6, -6));
  if (matchesKey(data, Key.enter)) return passiveCommand(editor);
  const prefixes = commands.map(command => `/maintenance ${command}`);
  const printable = decodeKittyPrintable(data) ?? (/^[^\x00-\x1f\x7f]+$/.test(data) ? data : "");
  const candidate = editor + printable;
  if (/[\r\n]/.test(candidate)) return false;
  return candidate.startsWith("/") && (prefixes.some(prefix => prefix.startsWith(candidate)) || passiveCommand(candidate));
}
