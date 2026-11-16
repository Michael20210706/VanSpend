// 核对界面用: 实付 − 明细金额之和 − GST − PST(四舍五入到分)。没有明细或没填实付时返回 0，表示"无从比较"而不是"对得上"
export function totalsGap(rows, gst, pst, total) {
  const t = Number(total) || 0;
  if (!Array.isArray(rows) || rows.length === 0 || t <= 0) return 0;
  const sum = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  return +(t - sum - (Number(gst) || 0) - (Number(pst) || 0)).toFixed(2);
}

// 超过 2 分才算对不上(与 normalize() 加差额行的阈值一致)
export const gapIsMismatch = (gap) => Math.abs(gap) > 0.02;
