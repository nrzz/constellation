"""The tmux screen in display cells, for tests/e2e/lib.sh.

A terminal column is a cell, not a character and not a byte: the box drawing,
the logo's blocks and the map's glyphs are one cell and several bytes; an East
Asian wide character is two cells. A mouse event names a cell, so the helpers
that find text to click must count cells.

  python3 cells.py locate <text> <fromRow> <toRow>   "row col" (1-based) of the text's first cell
  python3 cells.py cut <fromCol> [toCol]              the screen's lines, cut to those cells (1-based)
  python3 cells.py dot <row> <col> <glyph>            "row col" of a lone glyph (a satellite, not a label's own glyph) within four rows of <row>, nearest
  python3 cells.py find <regex> <fromRow> <toRow> [fromCol]   "row col" of the regex's first match (its first group, if any)
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
    if cmd == 'find':
        import re
        rx, lo, hi = re.compile(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
        c0 = int(sys.argv[5]) if len(sys.argv) > 5 else 1
        for n, line in enumerate(lines, 1):
            if not lo <= n <= hi:
                continue
            cs = cells(line)
            for m in rx.finditer(line):
                i = m.start(1) if m.groups() else m.start()
                col = cs[i][0] if i < len(cs) else len(line) + 1
                if col >= c0:
                    print(n, col)
                    return 0
        return 1
    if cmd == 'dot':
        r0, c0, glyph = int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
        best = None
        for r in range(r0 - 4, r0 + 5):
            if r == r0 or not 1 <= r <= len(lines):
                continue
            line = lines[r - 1]
            for i, (col, ch) in enumerate(cells(line)):
                # A label's own glyph ("○ Unsorted 1") is a topic, not a satellite: a letter follows it after one space.
                if ch != glyph or (line[i + 1:i + 2] == ' ' and line[i + 2:i + 3].isalpha()):
                    continue
                d = abs(col - c0) + 2 * abs(r - r0)
                if best is None or d < best[0]:
                    best = (d, r, col)
        if best is None:
            return 1
        print(best[1], best[2])
        return 0
    return 2


sys.exit(main())
