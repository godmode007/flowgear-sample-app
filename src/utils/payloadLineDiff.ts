import { diffLines } from "diff";

export type PayloadDiffSideRow = {
  left: string;
  right: string;
  leftKind: "same" | "removed" | "blank";
  rightKind: "same" | "added" | "blank";
};

/** Split a diff chunk into lines (LF); trim only a single trailing empty segment from split. */
function chunkToLines(value: string): string[] {
  const n = value.replace(/\r\n/g, "\n");
  if (n.length === 0) return [];
  const parts = n.split("\n");
  if (parts.length > 1 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}

/**
 * Build aligned rows for a side-by-side view: left = target, right = source.
 * Uses line-level diff; rows only on one side use blank padding on the other.
 */
export function sideBySideLineDiff(leftText: string, rightText: string): PayloadDiffSideRow[] {
  const rows: PayloadDiffSideRow[] = [];
  for (const part of diffLines(leftText, rightText)) {
    const lines = chunkToLines(part.value);
    if (lines.length === 0) continue;

    if (!part.added && !part.removed) {
      for (const line of lines) {
        rows.push({ left: line, right: line, leftKind: "same", rightKind: "same" });
      }
    } else if (part.removed) {
      for (const line of lines) {
        rows.push({ left: line, right: "", leftKind: "removed", rightKind: "blank" });
      }
    } else if (part.added) {
      for (const line of lines) {
        rows.push({ left: "", right: line, leftKind: "blank", rightKind: "added" });
      }
    }
  }
  return rows;
}
