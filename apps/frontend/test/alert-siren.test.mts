import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

/**
 * Tests de la sirène d'alerte.
 *
 * Le son ne peut pas être « écouté » par un test : on vérifie donc le signal
 * programmé — durée, alternances de tonalité, amplitude, timbre — et surtout la
 * mécanique de déblocage, qui est la partie qui a réellement cassé en
 * conditions normales (voir « politique de lecture automatique »).
 */

interface Programmation {
  frequences: number[];
  gains: number[];
  debut: number;
  fin: number;
  timbre: string;
}

let programmations: Programmation[] = [];

/**
 * Faux contexte audio, réglable pour rejouer les deux régimes des navigateurs :
 * autorisé d'emblée, ou suspendu tant qu'aucun geste n'a eu lieu.
 */
class FauxAudioContext {
  /** État dans lequel démarre tout nouveau contexte. */
  static etatInitial: 'running' | 'suspended' = 'running';
  /** `resume()` réveille-t-il réellement le contexte ? */
  static resumeReussit = true;
  /** Nombre de contextes créés, pour vérifier qu'un contexte bloqué est bien jeté. */
  static crees = 0;
  static fermes = 0;

  state: 'running' | 'suspended' | 'closed';
  currentTime = 0;
  sampleRate = 48000;
  destination = { nom: 'destination' };
  private ecouteurs = new Set<() => void>();

  constructor() {
    FauxAudioContext.crees += 1;
    this.state = FauxAudioContext.etatInitial;
  }

  addEventListener(_nom: string, fn: () => void): void {
    this.ecouteurs.add(fn);
  }
  removeEventListener(_nom: string, fn: () => void): void {
    this.ecouteurs.delete(fn);
  }

  async resume(): Promise<void> {
    if (!FauxAudioContext.resumeReussit) {
      // Reproduit le cas qui a cassé : une promesse qui ne se résout jamais.
      return new Promise<void>(() => undefined);
    }
    this.state = 'running';
    for (const fn of this.ecouteurs) fn();
  }

  async close(): Promise<void> {
    FauxAudioContext.fermes += 1;
    this.state = 'closed';
  }

  createBuffer(): unknown {
    return {};
  }
  createBufferSource(): unknown {
    return { buffer: null, connect: () => undefined, start: () => undefined };
  }

  createOscillator(): unknown {
    const programmation: Programmation = { frequences: [], gains: [], debut: 0, fin: 0, timbre: '' };
    programmations.push(programmation);

    const oscillateur = {
      type: '',
      frequency: { setValueAtTime: (value: number) => programmation.frequences.push(value) },
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

/** Faux `document` : enregistre les écouteurs et permet de simuler un geste. */
function fauxDocument() {
  const ecouteurs = new Map<string, Set<EventListener>>();
  return {
    addEventListener: (nom: string, fn: EventListener) => {
      if (!ecouteurs.has(nom)) ecouteurs.set(nom, new Set());
      ecouteurs.get(nom)!.add(fn);
    },
    removeEventListener: (nom: string, fn: EventListener) => ecouteurs.get(nom)?.delete(fn),
    declencher: (nom: string) => {
      for (const fn of [...(ecouteurs.get(nom) ?? [])]) fn(new Object() as Event);
    },
    nombreEcouteurs: () => [...ecouteurs.values()].reduce((total, set) => total + set.size, 0),
  };
}

let AlertSiren: typeof import('../lib/alert-siren.ts').AlertSiren;

before(async () => {
  (globalThis as Record<string, unknown>)['window'] = globalThis;
  (globalThis as Record<string, unknown>)['AudioContext'] = FauxAudioContext;
  ({ AlertSiren } = await import('../lib/alert-siren.ts'));
});

beforeEach(() => {
  programmations = [];
  FauxAudioContext.etatInitial = 'running';
  FauxAudioContext.resumeReussit = true;
  FauxAudioContext.crees = 0;
  FauxAudioContext.fermes = 0;
  (globalThis as Record<string, unknown>)['document'] = fauxDocument();
});

describe('AlertSiren — déblocage', () => {
  it('est prête sans rien demander quand le navigateur autorise déjà le son', () => {
    const sirene = new AlertSiren();
    assert.equal(sirene.tryUnlock(), 'ready');
  });

  describe('quand le navigateur exige un geste', () => {
    beforeEach(() => {
      FauxAudioContext.etatInitial = 'suspended';
    });

    it('signale que le son est bloqué', () => {
      const sirene = new AlertSiren();
      assert.equal(sirene.tryUnlock(), 'blocked');
    });

    /**
     * Régression corrigée : un contexte créé hors geste est marqué bloqué par
     * Chrome, et le `resume()` d'un clic ultérieur ne le réveille pas de façon
     * fiable. On le referme donc pour repartir d'un contexte neuf.
     */
    it('jette le contexte créé hors geste au lieu de le conserver', () => {
      const sirene = new AlertSiren();
      sirene.tryUnlock();
      assert.equal(FauxAudioContext.crees, 1);
      assert.equal(FauxAudioContext.fermes, 1, 'le contexte bloqué aurait dû être fermé');
    });

    it('se débloque sur un geste, avec un contexte neuf', () => {
      const faux = globalThis.document as unknown as ReturnType<typeof fauxDocument>;
      const sirene = new AlertSiren();

      sirene.armOnFirstGesture();
      sirene.tryUnlock();

      faux.declencher('pointerdown');
      assert.equal(sirene.state, 'ready');
      assert.equal(FauxAudioContext.crees, 2, 'un contexte neuf aurait dû être créé pour le geste');
    });

    /**
     * **Le bug qui a été signalé.** Quand `resume()` ne se résout jamais, tout
     * code enchaîné derrière ne s'exécute pas. Si les écouteurs de geste en
     * dépendaient, plus aucun clic ne pouvait débloquer le son : le bandeau
     * restait affiché indéfiniment. Ils doivent donc être posés de façon
     * synchrone, sans rien attendre.
     */
    it('pose ses écouteurs même si resume() ne se résout jamais', () => {
      FauxAudioContext.resumeReussit = false;
      const faux = globalThis.document as unknown as ReturnType<typeof fauxDocument>;

      const sirene = new AlertSiren();
      sirene.armOnFirstGesture();
      sirene.tryUnlock();

      assert.ok(faux.nombreEcouteurs() > 0, 'aucun écouteur posé : un clic ne pourrait rien débloquer');

      // Le geste ne réussit pas non plus, mais l'écoute doit persister pour les
      // gestes suivants plutôt que d'abandonner définitivement.
      faux.declencher('pointerdown');
      assert.ok(faux.nombreEcouteurs() > 0, 'les écouteurs auraient dû rester en place');
    });

    it('notifie l’interface du changement d’état', () => {
      const faux = globalThis.document as unknown as ReturnType<typeof fauxDocument>;
      const sirene = new AlertSiren();
      const etats: string[] = [];

      sirene.onStateChange((state) => etats.push(state));
      sirene.armOnFirstGesture();
      sirene.tryUnlock();

      faux.declencher('mousedown');
      assert.ok(etats.includes('ready'), `états observés : ${etats.join(', ')}`);
    });

    it('se désarme une fois le son débloqué', () => {
      const faux = globalThis.document as unknown as ReturnType<typeof fauxDocument>;
      const sirene = new AlertSiren();

      sirene.armOnFirstGesture();
      faux.declencher('keydown');

      assert.equal(faux.nombreEcouteurs(), 0, 'les écouteurs auraient dû être retirés');
    });
  });

  it('refuse de jouer tant que le son est bloqué', () => {
    FauxAudioContext.etatInitial = 'suspended';
    const sirene = new AlertSiren();
    sirene.tryUnlock();
    assert.equal(sirene.play('critical'), false);
  });
});

describe('AlertSiren — signal sonore', () => {
  const jouer = (severite: 'critical' | 'warning') => {
    programmations = [];
    const sirene = new AlertSiren();
    sirene.tryUnlock();
    const joue = sirene.play(severite);
    return { joue, programmation: programmations[0]! };
  };

  describe('alerte critique', () => {
    it('dure assez longtemps pour faire lever la tête', () => {
      const { joue, programmation } = jouer('critical');
      assert.equal(joue, true);
      assert.equal(programmation.fin - programmation.debut, 8);
    });

    it('alterne deux tonalités de nombreuses fois, comme une sirène', () => {
      const { programmation } = jouer('critical');
      assert.ok(programmation.frequences.length >= 20, `seulement ${programmation.frequences.length} tonalités`);

      const distinctes = new Set(programmation.frequences);
      assert.equal(distinctes.size, 2, 'un son à une seule fréquence n’attire pas l’attention');
      assert.deepEqual([...distinctes].sort((a, b) => b - a), [988, 740]);
    });

    it('utilise un timbre perçant et un volume élevé', () => {
      const { programmation } = jouer('critical');
      // La dent de scie est bien plus riche en harmoniques qu'une sinusoïde :
      // à volume égal, elle porte beaucoup plus loin.
      assert.equal(programmation.timbre, 'sawtooth');
      assert.ok(Math.max(...programmation.gains) >= 0.5, 'volume trop faible pour un open space');
    });

    it('pulse au lieu de tenir une note continue', () => {
      const { programmation } = jouer('critical');
      const niveaux = new Set(programmation.gains.map((g) => Math.round(g * 100)));
      assert.ok(niveaux.size >= 2, 'aucune pulsation : le son est plat');
    });
  });

  it('garde l’avertissement bref et plus discret que le critique', () => {
    const critique = jouer('critical');
    const avertissement = jouer('warning');

    const dureeAvertissement = avertissement.programmation.fin - avertissement.programmation.debut;
    const dureeCritique = critique.programmation.fin - critique.programmation.debut;

    assert.ok(dureeAvertissement < dureeCritique / 2, 'un avertissement ne doit pas interrompre le plateau');
    assert.ok(Math.max(...avertissement.programmation.gains) < Math.max(...critique.programmation.gains));
  });

  it('interrompt la sirène en cours plutôt que de superposer deux sons', () => {
    programmations = [];
    const sirene = new AlertSiren();
    sirene.tryUnlock();

    sirene.play('warning');
    sirene.play('critical');

    assert.equal(programmations.length, 2);
  });

  it('peut être coupée à la demande', () => {
    const sirene = new AlertSiren();
    sirene.tryUnlock();
    sirene.play('critical');
    assert.doesNotThrow(() => sirene.stop());
  });
});
