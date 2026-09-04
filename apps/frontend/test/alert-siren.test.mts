import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

/**
 * Tests de la sirène d'alerte.
 *
 * Le son ne peut pas être « écouté » par un test : on vérifie donc le signal
 * programmé — durée, nombre d'alternances de tonalité, amplitude, timbre. Ce
 * sont exactement les propriétés qui font qu'une alerte critique s'entend à
 * l'autre bout d'un open space plutôt que de passer pour une notification de
 * téléphone.
 */

interface Programmation {
  frequences: number[];
  gains: number[];
  debut: number;
  fin: number;
  timbre: string;
}

let programmations: Programmation[] = [];

/** Faux contexte audio : enregistre ce qui aurait été joué. */
class FauxAudioContext {
  state = 'running';
  currentTime = 0;
  destination = { nom: 'destination' };

  async resume(): Promise<void> {
    this.state = 'running';
  }

  createOscillator(): unknown {
    const programmation: Programmation = { frequences: [], gains: [], debut: 0, fin: 0, timbre: '' };
    programmations.push(programmation);

    const oscillateur = {
      type: '',
      frequency: {
        setValueAtTime: (value: number) => programmation.frequences.push(value),
      },
      connect: (cible: unknown) => cible,
      start: (when: number) => {
        programmation.debut = when;
      },
      stop: (when: number) => {
        programmation.fin = when;
        programmation.timbre = oscillateur.type;
      },
      disconnect: () => undefined,
      onended: null as null | (() => void),
    };
    return oscillateur;
  }

  createGain(): unknown {
    const programmation = programmations[programmations.length - 1];
    return {
      gain: {
        setValueAtTime: (value: number) => programmation?.gains.push(value),
        exponentialRampToValueAtTime: (value: number) => programmation?.gains.push(value),
        linearRampToValueAtTime: (value: number) => programmation?.gains.push(value),
      },
      connect: (cible: unknown) => cible,
      disconnect: () => undefined,
    };
  }
}

let AlertSiren: typeof import('../lib/alert-siren.ts').AlertSiren;

before(async () => {
  (globalThis as Record<string, unknown>)['window'] = globalThis;
  (globalThis as Record<string, unknown>)['AudioContext'] = FauxAudioContext;
  ({ AlertSiren } = await import('../lib/alert-siren.ts'));
});

describe('AlertSiren', () => {
  const jouer = async (severite: 'critical' | 'warning') => {
    programmations = [];
    const sirene = new AlertSiren();
    await sirene.unlock();
    const joue = sirene.play(severite);
    return { joue, programmation: programmations[0]! };
  };

  it('refuse de jouer tant que le son n’a pas été autorisé', () => {
    const sirene = new AlertSiren();
    // Sans `unlock()`, aucun contexte : c'est le comportement imposé par les
    // navigateurs, et le signaler vaut mieux que d'échouer en silence.
    assert.equal(sirene.state, 'blocked');
    assert.equal(sirene.play('critical'), false);
  });

  it('devient prête après autorisation', async () => {
    const sirene = new AlertSiren();
    assert.equal(await sirene.unlock(), 'ready');
    assert.equal(sirene.state, 'ready');
  });

  describe('alerte critique', () => {
    it('dure assez longtemps pour faire lever la tête', async () => {
      const { joue, programmation } = await jouer('critical');
      assert.equal(joue, true);
      assert.equal(programmation.fin - programmation.debut, 8);
    });

    it('alterne deux tonalités de nombreuses fois, comme une sirène', async () => {
      const { programmation } = await jouer('critical');
      // 8 s à 0,32 s par tonalité : une vingtaine d'alternances.
      assert.ok(programmation.frequences.length >= 20, `seulement ${programmation.frequences.length} tonalités`);

      const distinctes = new Set(programmation.frequences);
      assert.equal(distinctes.size, 2, 'un son à une seule fréquence n’attire pas l’attention');
      assert.deepEqual([...distinctes].sort((a, b) => b - a), [988, 740]);
    });

    it('utilise un timbre perçant et un volume élevé', async () => {
      const { programmation } = await jouer('critical');
      // La dent de scie est bien plus riche en harmoniques qu'une sinusoïde :
      // à volume égal, elle porte beaucoup plus loin.
      assert.equal(programmation.timbre, 'sawtooth');
      assert.ok(Math.max(...programmation.gains) >= 0.5, 'volume trop faible pour un open space');
    });

    it('pulse au lieu de tenir une note continue', async () => {
      const { programmation } = await jouer('critical');
      // Une note tenue se fond dans le bruit ambiant au bout de deux secondes.
      const niveaux = new Set(programmation.gains.map((g) => Math.round(g * 100)));
      assert.ok(niveaux.size >= 2, 'aucune pulsation : le son est plat');
    });
  });

  describe('avertissement', () => {
    it('reste bref et plus discret que le critique', async () => {
      const critique = await jouer('critical');
      const avertissement = await jouer('warning');

      const dureeAvertissement = avertissement.programmation.fin - avertissement.programmation.debut;
      const dureeCritique = critique.programmation.fin - critique.programmation.debut;

      assert.ok(dureeAvertissement < dureeCritique / 2, 'un avertissement ne doit pas interrompre le plateau');
      assert.ok(Math.max(...avertissement.programmation.gains) < Math.max(...critique.programmation.gains));
    });
  });

  it('interrompt la sirène en cours plutôt que de superposer deux sons', async () => {
    programmations = [];
    const sirene = new AlertSiren();
    await sirene.unlock();

    sirene.play('warning');
    sirene.play('critical');

    // Deux oscillateurs créés, mais le premier a été arrêté : deux sirènes
    // simultanées ne s'entendent plus, et c'est la plus grave qui compte.
    assert.equal(programmations.length, 2);
  });

  describe('déblocage au premier geste', () => {
    /** Faux `document` : enregistre les écouteurs posés et permet de les déclencher. */
    const fauxDocument = () => {
      const ecouteurs = new Map<string, Set<EventListener>>();
      return {
        addEventListener: (nom: string, fn: EventListener) => {
          if (!ecouteurs.has(nom)) ecouteurs.set(nom, new Set());
          ecouteurs.get(nom)!.add(fn);
        },
        removeEventListener: (nom: string, fn: EventListener) => ecouteurs.get(nom)?.delete(fn),
        declencher: (nom: string) => {
          for (const fn of ecouteurs.get(nom) ?? []) fn(new Object() as Event);
        },
        nombreEcouteurs: () => [...ecouteurs.values()].reduce((total, set) => total + set.size, 0),
      };
    };

    /**
     * Aucune autorisation ne peut être accordée par le code : la politique est
     * appliquée par le navigateur. Mais rien n'impose de réclamer un clic
     * *dédié* — n'importe quel geste débloque le son, ce qui permet de
     * supprimer toute étape de consentement.
     */
    it('s’active sur un simple clic, sans bouton dédié', async () => {
      const faux = fauxDocument();
      (globalThis as Record<string, unknown>)['document'] = faux;

      const sirene = new AlertSiren();
      const etats: string[] = [];
      sirene.armOnFirstGesture((state) => etats.push(state));

      assert.ok(faux.nombreEcouteurs() > 0, 'aucun écouteur posé');
      faux.declencher('pointerdown');
      await new Promise((r) => setTimeout(r, 10));

      assert.deepEqual(etats, ['ready']);
      assert.equal(sirene.state, 'ready');
    });

    it('se désarme une fois le son débloqué', async () => {
      const faux = fauxDocument();
      (globalThis as Record<string, unknown>)['document'] = faux;

      const sirene = new AlertSiren();
      sirene.armOnFirstGesture(() => undefined);
      faux.declencher('keydown');
      await new Promise((r) => setTimeout(r, 10));

      assert.equal(faux.nombreEcouteurs(), 0, 'les écouteurs auraient dû être retirés');
    });

    it('ne pose aucun écouteur si le son est déjà prêt', async () => {
      const faux = fauxDocument();
      (globalThis as Record<string, unknown>)['document'] = faux;

      const sirene = new AlertSiren();
      await sirene.unlock();
      sirene.armOnFirstGesture(() => undefined);

      assert.equal(faux.nombreEcouteurs(), 0);
    });
  });

  it('peut être coupée à la demande', async () => {
    const sirene = new AlertSiren();
    await sirene.unlock();
    sirene.play('critical');
    assert.doesNotThrow(() => sirene.stop());
  });
});
