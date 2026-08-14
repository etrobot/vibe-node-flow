function text(value: unknown): string {
  return String(value ?? '').trim();
}

function parseCsvRows(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && value[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function csvValue(value: string): boolean | string {
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  return value;
}

export function parseComparisonCsv(value: unknown): {
  featureLabel: string;
  columns: Array<{ label: string }>;
  rows: Array<{ feature: string; values: Array<boolean | string> }>;
} | null {
  const parsed = parseCsvRows(text(value));
  if (parsed.length < 2 || parsed[0].length < 2) return null;
  const featureLabel = parsed[0][0];
  const columns = parsed[0].slice(1).map((label) => ({ label }));
  const rows = parsed.slice(1)
    .filter((cells) => text(cells[0]))
    .map((cells) => ({
      feature: cells[0],
      values: columns.map((_, index) => csvValue(cells[index + 1] ?? '')),
    }));
  return rows.length ? { featureLabel, columns, rows } : null;
}
