"""Print one version's section of CHANGELOG.md as GitHub release notes.

Usage: release-notes.py <version> [changelog]. Prints nothing when the version has no section.
The changelog is hard-wrapped, and GitHub release pages keep single line breaks, so paragraph and
list-item lines are joined back up; headings, blank lines and indented code blocks are kept as they are.
"""
import re
import sys

version = sys.argv[1]
path = sys.argv[2] if len(sys.argv) > 2 else 'CHANGELOG.md'

section, inside = [], False
for line in open(path, encoding='utf-8').read().splitlines():
    if line.startswith('## '):
        inside = line == f'## {version}' or line.startswith(f'## {version} ')
        continue
    if inside:
        section.append(line)

out, previous = [], 'blank'
for line in section:
    if not line.strip():
        out.append('')
        previous = 'blank'
    elif line.startswith('#'):
        out.append(line)
        previous = 'heading'
    elif line.startswith('    ') and previous in ('blank', 'code'):
        out.append(line)
        previous = 'code'
    elif re.match(r'\s*([-*+]|\d+\.)\s', line) or previous in ('blank', 'heading', 'code'):
        out.append(line)
        previous = 'text'
    else:
        out[-1] += ' ' + line.strip()

print('\n'.join(out).strip())
