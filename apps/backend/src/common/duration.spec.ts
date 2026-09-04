import { durationToMs, windowStart } from './duration';

describe('durationToMs', () => {
  it('convertit chaque unité', () => {
    expect(durationToMs('30s')).toBe(30_000);
    expect(durationToMs('15m')).toBe(900_000);
    expect(durationToMs('2h')).toBe(7_200_000);
    expect(durationToMs('1d')).toBe(86_400_000);
  });

  it('refuse un format inconnu plutôt que de deviner', () => {
    expect(() => durationToMs('15')).toThrow(/invalide/);
    expect(() => durationToMs('15w')).toThrow(/invalide/);
    expect(() => durationToMs('')).toThrow(/invalide/);
  });
});

describe('windowStart', () => {
  it('recule de la durée demandée', () => {
    const now = new Date('2026-09-03T12:00:00.000Z');
    expect(windowStart('5m', now).toISOString()).toBe('2026-09-03T11:55:00.000Z');
  });
});
