export const PRESETS = [
  { key: 'thisMonth', label: '当月' },
  { key: 'lastMonth', label: '上月' },
  { key: 'last3m', label: '近3个月' },
  { key: 'last6m', label: '近半年' },
  { key: 'last1y', label: '近1年' },
];

const pad2 = (n) => String(n).padStart(2, '0');
const toISO = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

export function computePresetRange(kind) {
  const now = new Date();
  let from, to = now;
  if (kind === 'thisMonth') from = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (kind === 'lastMonth') { from = new Date(now.getFullYear(), now.getMonth() - 1, 1); to = new Date(now.getFullYear(), now.getMonth(), 0); }
  else if (kind === 'last3m') from = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
  else if (kind === 'last6m') from = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
  else if (kind === 'last1y') from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  else return null;
  return [toISO(from), toISO(to)];
}
