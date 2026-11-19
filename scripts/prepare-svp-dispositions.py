"""Normalize the RingCX XLSX export without executing workbook content.

Usage: python scripts/prepare-svp-dispositions.py workbook.xlsx work/svp-calls.json
The output is private intermediate data: keep it out of version control.
Only explicit merged ranges inherit their top-left value; unrelated blanks stay blank.
"""
import datetime
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def address(value):
    match = re.fullmatch(r'([A-Z]+)([1-9][0-9]*)', value)
    if not match:
        raise ValueError('Invalid cell address')
    col = 0
    for letter in match[1]:
        col = col * 26 + ord(letter) - 64
    return int(match[2]), col - 1


def expand_merges(cells, ranges):
    for span in ranges:
        start, end = span.split(':')
        (first, left), (last, right) = address(start), address(end)
        if left != right or last - first > 100000:
            raise ValueError('Unsupported merged range')
        value = cells.get((first, left), '')
        for row in range(first + 1, last + 1):
            if cells.get((row, left), ''):
                raise ValueError('Merged range overlaps a populated cell')
            cells[(row, left)] = value


def prepare(source):
    cells, ranges, shared = {}, [], []
    with zipfile.ZipFile(source) as archive:
        if 'xl/sharedStrings.xml' in archive.namelist():
            shared = [''.join(item.itertext()) for item in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        root = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
        for cell in root.findall('.//s:sheetData/s:row/s:c', NS):
            value = cell.find('s:v', NS)
            inline = cell.find('s:is', NS)
            text = value.text or '' if value is not None else ''.join(inline.itertext()) if inline is not None else ''
            if cell.get('t') == 's':
                text = shared[int(text)]
            cells[address(cell.get('r'))] = text
        ranges = [item.get('ref') for item in root.findall('s:mergeCells/s:mergeCell', NS)]
    expand_merges(cells, ranges)
    headers = [cells.get((3, col), '').replace('\u200b', '').strip() for col in range(15)]
    expected = ['Date ( Interaction Start)', 'Agent', 'Number', 'State', 'Disposition', 'Disposition Notes', 'Call Recording', 'Auto Summary URL', 'Call Result', 'Start Time', 'Interaction Time', 'KPI Talk Time', 'KPI Handle Time', 'KPI Wrap Time', 'Hold Time']
    if headers != expected or cells.get((1, 0)) != 'Applied filters:':
        raise ValueError('Unexpected report columns or missing filter header')
    rows = []
    for row_number in range(4, max(row for row, _ in cells) + 1):
        row = [cells.get((row_number, col), '') for col in range(15)]
        if not any(row):
            continue
        try:
            row[0] = (datetime.date(1899, 12, 30) + datetime.timedelta(days=float(row[0]))).isoformat()
        except (ValueError, OverflowError):
            raise ValueError(f'Invalid date in row {row_number}') from None
        rows.append(row)
    if not rows:
        raise ValueError('Empty report')
    return {'version': 1, 'source': Path(source).name, 'importedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'appliedFilters': [cells.get((1, 1), '')], 'rows': rows}


if __name__ == '__main__':
    output = Path(sys.argv[2]).resolve()
    private = (Path.cwd() / 'work').resolve()
    if not output.is_relative_to(private):
        raise ValueError('Output must be inside the ignored work directory')
    result = prepare(sys.argv[1])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, separators=(',', ':')), encoding='utf-8')
    dates = [row[0] for row in result['rows']]
    print(json.dumps({'rows': len(dates), 'from': min(dates), 'to': max(dates), 'columns': 15, 'mergedRanges': 'expanded', 'appliedFilters': result['appliedFilters']}))
