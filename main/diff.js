// Small line diff (common prefix/suffix trim + LCS on the middle) producing context hunks.

function lineDiff(before, after, context = 3) {
  const a = before === null || before === undefined ? [] : String(before).split('\n');
  const b = String(after ?? '').split('\n');
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);

  let ops = [];
  if (am.length * bm.length > 4_000_000) {
    ops = am.map((t) => ['-', t]).concat(bm.map((t) => ['+', t]));
  } else {
    const n = am.length, m = bm.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      dp[i][j] = am[i] === bm[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (am[i] === bm[j]) { ops.push([' ', am[i]]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push(['-', am[i++]]); }
      else { ops.push(['+', bm[j++]]); }
    }
    while (i < n) ops.push(['-', am[i++]]);
    while (j < m) ops.push(['+', bm[j++]]);
  }
  const full = a.slice(0, pre).map((t) => [' ', t]).concat(ops, a.slice(a.length - suf).map((t) => [' ', t]));

  // Number lines and cut into hunks.
  let la = 1, lb = 1;
  const numbered = full.map(([op, text]) => {
    const row = { op, text, a: op !== '+' ? la : null, b: op !== '-' ? lb : null };
    if (op !== '+') la++;
    if (op !== '-') lb++;
    return row;
  });
  const keep = new Array(numbered.length).fill(false);
  numbered.forEach((r, idx) => {
    if (r.op !== ' ') for (let k = Math.max(0, idx - context); k <= Math.min(numbered.length - 1, idx + context); k++) keep[k] = true;
  });
  const hunks = [];
  let cur = null;
  numbered.forEach((r, idx) => {
    if (!keep[idx]) { cur = null; return; }
    if (!cur) { cur = []; hunks.push(cur); }
    cur.push(r);
  });
  const added = numbered.filter((r) => r.op === '+').length;
  const removed = numbered.filter((r) => r.op === '-').length;
  return { hunks: hunks.slice(0, 40), added, removed, truncated: hunks.length > 40 };
}

module.exports = { lineDiff };
