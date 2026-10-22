import { describe, expect, it } from 'vitest';
import { greeting } from './preferences';
describe('local time greetings', () => {
  it.each([[2, '夜深了'], [7, '早上好'], [11, '中午好'], [12, '中午好'], [14, '下午好'], [18, '晚上好'], [23, '晚上好']])('uses local hour %i', (hour, expected) => {
    expect(greeting(new Date(2026, 9, 22, Number(hour)))).toBe(expected);
  });
});
