// Tiny spreadsheet formula evaluator for Table cards (spec §3.2):
// =SUM(A1:A3), AVERAGE, MIN, MAX, COUNT, cell refs, + - * / and parentheses.

export type CellGetter = (col: number, row: number) => string;

export function colName(i: number): string {
  let s = '';
  i += 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

function parseRef(ref: string): [number, number] | null {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref);
  if (!m) return null;
  let c = 0;
  for (const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
  return [c - 1, parseInt(m[2], 10) - 1];
}

type Tok = { t: 'num'; v: number } | { t: 'ref'; v: string } | { t: 'fn'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      const m = /^[0-9]*\.?[0-9]+(e[+-]?\d+)?/i.exec(src.slice(i))!;
      out.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      const m = /^[A-Za-z]+\d*/.exec(src.slice(i))!;
      const word = m[0];
      i += word.length;
      if (/\d/.test(word)) out.push({ t: 'ref', v: word.toUpperCase() });
      else out.push({ t: 'fn', v: word.toUpperCase() });
      continue;
    }
    if ('+-*/(),:'.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue; }
    throw new Error('Unexpected ' + ch);
  }
  return out;
}

const FNS: Record<string, (xs: number[]) => number> = {
  SUM: (xs) => xs.reduce((a, b) => a + b, 0),
  AVERAGE: (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0),
  AVG: (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0),
  MIN: (xs) => (xs.length ? Math.min(...xs) : 0),
  MAX: (xs) => (xs.length ? Math.max(...xs) : 0),
  COUNT: (xs) => xs.length,
};

export function evaluate(raw: string, get: CellGetter, stack: Set<string> = new Set()): number | string {
  if (!raw.startsWith('=')) return raw;
  try {
    const toks = tokenize(raw.slice(1));
    let p = 0;
    const peek = () => toks[p];
    const eat = (v?: string) => {
      const t = toks[p++];
      if (!t || (v && (t.t !== 'op' || t.v !== v))) throw new Error('Syntax');
      return t;
    };
    const cellValue = (ref: string): number | null => {
      const rc = parseRef(ref);
      if (!rc) throw new Error('Bad ref');
      if (stack.has(ref)) throw new Error('Cycle');
      const s = get(rc[0], rc[1]);
      if (s === '' || s == null) return null;
      const next = new Set(stack).add(ref);
      const v = s.startsWith('=') ? evaluate(s, get, next) : s;
      if (typeof v === 'string' && v.startsWith('#')) throw new Error(v);
      const n = typeof v === 'number' ? v : parseFloat(v);
      return isNaN(n) ? null : n;
    };
    const args = (): number[] => {
      const vals: number[] = [];
      eat('(');
      if (peek()?.t === 'op' && peek().v === ')') { p++; return vals; }
      for (;;) {
        const t = peek();
        const t2 = toks[p + 1];
        if (t?.t === 'ref' && t2?.t === 'op' && t2.v === ':') {
          p += 2;
          const end = eat();
          if (end.t !== 'ref') throw new Error('Range');
          const a = parseRef(t.v)!;
          const b = parseRef(end.v)!;
          for (let c = Math.min(a[0], b[0]); c <= Math.max(a[0], b[0]); c++)
            for (let r = Math.min(a[1], b[1]); r <= Math.max(a[1], b[1]); r++) {
              const v = cellValue(colName(c) + (r + 1));
              if (v !== null) vals.push(v);
            }
        } else vals.push(expr());
        const sep = eat();
        if (sep.t === 'op' && sep.v === ')') break;
        if (!(sep.t === 'op' && sep.v === ',')) throw new Error('Syntax');
      }
      return vals;
    };
    const atom = (): number => {
      const t = eat();
      if (t.t === 'num') return t.v;
      if (t.t === 'ref') return cellValue(t.v) ?? 0;
      if (t.t === 'fn') {
        const f = FNS[t.v];
        if (!f) throw new Error('Unknown ' + t.v);
        return f(args());
      }
      if (t.v === '(') { const v = expr(); eat(')'); return v; }
      if (t.v === '-') return -atom();
      if (t.v === '+') return atom();
      throw new Error('Syntax');
    };
    const term = (): number => {
      let v = atom();
      while (peek()?.t === 'op' && (peek().v === '*' || peek().v === '/')) {
        const op = eat().v;
        const r = atom();
        v = op === '*' ? v * r : v / r;
      }
      return v;
    };
    const expr = (): number => {
      let v = term();
      while (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) {
        const op = eat().v;
        const r = term();
        v = op === '+' ? v + r : v - r;
      }
      return v;
    };
    const v = expr();
    if (p < toks.length) throw new Error('Syntax');
    if (!isFinite(v)) return '#DIV/0';
    return Math.round(v * 1e10) / 1e10;
  } catch (e) {
    const msg = (e as Error).message;
    return msg === 'Cycle' ? '#CYCLE' : msg.startsWith('#') ? msg : '#ERR';
  }
}
