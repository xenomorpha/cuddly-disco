import { describe, it, expect } from 'vitest';
import { evaluate, colName } from './formula';

const grid = [
  ['1', '2', '=A1+B1'],
  ['3', 'x', '=SUM(A1:A2)'],
  ['', '4', '=C3'],
];
const get = (c: number, r: number) => grid[r]?.[c] ?? '';

describe('formula', () => {
  it('passes through plain values', () => expect(evaluate('hello', get)).toBe('hello'));
  it('does arithmetic with precedence', () => expect(evaluate('=1+2*3-(4/2)', get)).toBe(5));
  it('reads refs and nested formulas', () => {
    expect(evaluate('=C1*2', get)).toBe(6);
    expect(evaluate('=C2', get)).toBe(4);
  });
  it('supports functions over ranges and lists', () => {
    expect(evaluate('=SUM(A1:B3)', get)).toBe(10);
    expect(evaluate('=AVERAGE(A1:A2)', get)).toBe(2);
    expect(evaluate('=MIN(A1:B2, 0.5)', get)).toBe(0.5);
    expect(evaluate('=MAX(A1,B1,7)', get)).toBe(7);
    expect(evaluate('=COUNT(A1:B3)', get)).toBe(4);
    expect(evaluate('=SUM()', get)).toBe(0);
  });
  it('reports errors', () => {
    expect(evaluate('=C3', get)).toBe('#CYCLE');
    expect(evaluate('=1/0', get)).toBe('#DIV/0');
    expect(evaluate('=FOO(1)', get)).toBe('#ERR');
    expect(evaluate('=1+', get)).toBe('#ERR');
    expect(evaluate('=1 2', get)).toBe('#ERR');
    expect(evaluate('=-A1', get)).toBe(-1);
  });
  it('names columns', () => {
    expect(colName(0)).toBe('A');
    expect(colName(25)).toBe('Z');
    expect(colName(26)).toBe('AA');
  });
});
