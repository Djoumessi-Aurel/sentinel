import type { QuietHours } from '@sentinel/shared-types';

import { isWithinQuietHours, mutedChannelsAt } from './quiet-hours';

/** Construit une date locale, le fuseau de l'opérateur faisant foi pour ses heures creuses. */
const at = (hours: number, minutes = 0): Date => new Date(2026, 8, 3, hours, minutes, 0);

describe('heures creuses', () => {
  const nuit: QuietHours = { enabled: true, start: '22:00', end: '06:00', mutedChannels: ['sound', 'sms'] };
  const journee: QuietHours = { enabled: true, start: '09:00', end: '17:00', mutedChannels: ['sound'] };

  describe('plage franchissant minuit', () => {
    it('est active après l’heure de début', () => {
      expect(isWithinQuietHours(nuit, at(22, 30))).toBe(true);
      expect(isWithinQuietHours(nuit, at(23, 59))).toBe(true);
    });

    it('est active avant l’heure de fin, le lendemain', () => {
      expect(isWithinQuietHours(nuit, at(0, 5))).toBe(true);
      expect(isWithinQuietHours(nuit, at(5, 59))).toBe(true);
    });

    it('est inactive en dehors', () => {
      expect(isWithinQuietHours(nuit, at(6, 0))).toBe(false);
      expect(isWithinQuietHours(nuit, at(14, 0))).toBe(false);
      expect(isWithinQuietHours(nuit, at(21, 59))).toBe(false);
    });
  });

  describe('plage dans la même journée', () => {
    it('est active entre les deux bornes', () => {
      expect(isWithinQuietHours(journee, at(9, 0))).toBe(true);
      expect(isWithinQuietHours(journee, at(16, 59))).toBe(true);
    });

    it('exclut la borne de fin', () => {
      expect(isWithinQuietHours(journee, at(17, 0))).toBe(false);
      expect(isWithinQuietHours(journee, at(8, 59))).toBe(false);
    });
  });

  describe('cas limites', () => {
    it('est inactive si le réglage est désactivé', () => {
      expect(isWithinQuietHours({ ...nuit, enabled: false }, at(23, 0))).toBe(false);
    });

    it('est inactive sans réglage', () => {
      expect(isWithinQuietHours(null, at(23, 0))).toBe(false);
    });

    /**
     * Bornes identiques : on choisit « jamais » plutôt que « toujours ». Une
     * saisie ambiguë ne doit pas faire taire la supervision 24 h sur 24.
     */
    it('est inactive quand début et fin coïncident', () => {
      expect(isWithinQuietHours({ ...nuit, start: '22:00', end: '22:00' }, at(22, 0))).toBe(false);
      expect(isWithinQuietHours({ ...nuit, start: '22:00', end: '22:00' }, at(10, 0))).toBe(false);
    });
  });

  describe('canaux mis en sourdine', () => {
    it('retourne les canaux listés pendant la plage', () => {
      expect([...mutedChannelsAt(nuit, at(23, 0))].sort()).toEqual(['sms', 'sound']);
    });

    it('ne coupe rien hors de la plage', () => {
      expect(mutedChannelsAt(nuit, at(12, 0)).size).toBe(0);
    });

    /**
     * Les canaux non listés restent actifs : couper *tous* les canaux
     * transformerait les heures creuses en angle mort (docs/ALERTING.md §4).
     */
    it('laisse actifs les canaux non listés', () => {
      const muted = mutedChannelsAt(nuit, at(23, 0));
      expect(muted.has('email')).toBe(false);
      expect(muted.has('visual')).toBe(false);
    });
  });
});
