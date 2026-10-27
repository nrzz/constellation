"""The tmux screen in display cells, for tests/e2e/lib.sh.

A terminal column is a cell, not a character and not a byte: the box drawing,
the logo's blocks and the map's glyphs are one cell and several bytes; an East
Asian wide character is two cells. A mouse event names a cell, so the helpers
that find text to click must count cells.

  python3 cells.py locate <text> <fromRow> <toRow>   "row col" (1-based) of the text's first cell
  python3 cells.py cut <fromCol> [toCol]              the screen's lines, cut to those cells (1-based)
  python3 cells.py dot <row> <col> <glyph>            "row col" of the glyph on the rows within two of <row>, nearest <col>
The screen comes on stdin (tmux capture-pane -p).
"""
import sys
import unicodedata


def width(ch):
    if unicodedata.combining(ch):
        return 0
    return 2 if unicodedata.east_asian_width(ch) in ('W', 'F') else 1


def cells(line):
    """[(col, ch)] with 1-based columns."""
    out, col = [], 1
    for ch in line:
        out.append((col, ch))
        col += width(ch)
    return out


def text_at(line):
    """The line as a list of single cells: a wide character's second cell is ''."""
    row = []
    for ch in line:
        row.append(ch)
        if width(ch) == 2:
            row.append('')
    return row


def main():
    lines = sys.stdin.read().split('\n')
    if len(sys.argv) < 2 or any(a == '' for a in sys.argv[2:]):
        return 1
    cmd = sys.argv[1]
    if cmd == 'locate':
        pat, lo, hi = sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
        for n, line in enumerate(lines, 1):
            if lo <= n <= hi:
                i = line.find(pat)
                if i >= 0:
                    print(n, cells(line)[i][0] if i < len(line) else len(line) + 1)
                    return 0
        return 1
    if cmd == 'cut':
        a = int(sys.argv[2])
        b = int(sys.argv[3]) if len(sys.argv) > 3 else None
        for line in lines:
            row = text_at(line)
            part = row[a - 1:b] if b else row[a - 1:]
            print(''.join(part).rstrip())
        return 0
    if cmd == 'dot':
        r0, c0, glyph = int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
        best = None
        for r in (r0 - 2, r0 - 1, r0 + 1, r0 + 2):
            if not 1 <= r <= len(lines):
                continue
            for col, ch in cells(lines[r - 1]):
                if ch == glyph:
                    d = abs(col - c0)
                    if best is None or d < best[0]:
                        best = (d, r, col)
        if best is None:
            return 1
        print(best[1], best[2])
        return 0
    return 2


sys.exit(main())
