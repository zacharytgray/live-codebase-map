export function add(a: number, b: number): number {
  return a + b;
}

export const mul = (a: number, b: number): number => a * b;

const internal = () => 42;

export interface Point {
  x: number;
  y: number;
}
