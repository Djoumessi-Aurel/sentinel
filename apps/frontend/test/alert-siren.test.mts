import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

/**
 * Tests de la sirène d'alerte.
 *
 * Deux niveaux :
 *  - le **signal** lui-même (durée, alternances, timbre, amplitude), qui décide
 *    si le son fait lever la tête ou passe pour une notification de téléphone ;
 *  - la **mécanique de déclenchement**, qui est la partie ayant réellement
 *    échoué en conditions normales et qui mérite donc des tests de régression.
 */

// --- Doublures du navigateur -------------------------------------------------

interface Programmation {
  frequences: number[];
  gains: number[];
  debut: number;
  fin: number;
  timbre: string;
}

/** Contexte audio factice : enregistre ce qui aurait été programmé. */
class FauxContexte {
  readonly programmations: Programmation[] = [];
  destination = { nom: 'destination' };

  createOscillator(): unknown {
    const programmation: Programmation = { frequences: [], gains: [], debut: 0, fin: 0, timbre: '' };
    this.programmations.push(programmation);
    const oscillateur = {
      type: '',
      frequency: { setValueAtTime: (v: number) => programmation.frequences.push(v) },
      connect: (cible: unknown) => cible,
      start: (when: number) => {
        programmation.debut = when;
      },
      stop: (when: number) => {
        programmation.fin = when;
        programmation.timbre = oscillateur.type;
      },
    };
    return oscillateur;
  }

  createGain(): unknown {
    const programmation = this.programmations[this.programmations.length - 1];
    return {
      gain: {
        setValueAtTime: (v: number) => programmation?.gains.push(v),
        exponentialRampToValueAtTime: (v: number) => programmation?.gains.push(v),
        linearRampToValueAtTime: (v: number) => programmation?.gains.push(v),
      },
      connect: (cible: unknown) => cible,
    };
  }
}

class FauxOfflineAudioContext extends FauxContexte {
  // Champs déclarés puis affectés : les « paramètres-propriétés » de TypeScript
  // ne sont pas gérés par le mode d'exécution directe de Node.
  length: number;
  sampleRate: number;

  constructor(_channels: number, length: number, sampleRate: number) {
    super();
    this.length = length;
    this.sampleRate = sampleRate;
  }

  async startRendering(): Promise<{ getChannelData: () => Float32Array }> {
    return { getChannelData: () => new Float32Array(this.length) };
  }
}

/** Élément `<audio>` factice, dont on pilote l'autorisation de lecture. */
class FauxAudio {
  /** Le navigateur autorise-t-il la lecture automatique ? */
  static autorise = true;
  static instances: FauxAudio[] = [];

  src = '';
  volume = 1;
  currentTime = 0;
  preload = '';
  readonly lectures: string[] = [];
  pauses = 0;

  constructor() {
    FauxAudio.instances.push(this);
  }

  async play(): Promise<void> {
    if (!FauxAudio.autorise) {
      const erreur = new Error('play() failed because the user didn’t interact with the document first.');
      erreur.name = 'NotAllowedError';
      throw erreur;
    }
    this.lectures.push(this.src);
  }

  pause(): void {
    this.pauses += 1;
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

let sonModule: typeof import('../lib/siren-sound.ts');
let AlertSiren: typeof import('../lib/alert-siren.ts').AlertSiren;

before(async () => {
  const globaux = globalThis as Record<string, unknown>;
  globaux['window'] = globalThis;
  globaux['Audio'] = FauxAudio;
  globaux['OfflineAudioContext'] = FauxOfflineAudioContext;
  // `URL.createObjectURL` existe nativement dans Node : ne pas y toucher, la
  // remplacer casse des rouages internes du lanceur de tests.

  sonModule = await import('../lib/siren-sound.ts');
  ({ AlertSiren } = await import('../lib/alert-siren.ts'));
});

beforeEach(() => {
  FauxAudio.autorise = true;
  FauxAudio.instances = [];
  (globalThis as Record<string, unknown>)['document'] = fauxDocument();
});

// --- Le signal sonore --------------------------------------------------------

describe('signal de la sirène', () => {
  const programmer = (severite: 'critical' | 'warning') => {
    const contexte = new FauxContexte();
    sonModule.scheduleSiren(contexte as unknown as BaseAudioContext, sonModule.PATTERNS[severite]);
    return contexte.programmations[0]!;
  };

  describe('alerte critique', () => {
    it('dure assez longtemps pour faire lever la tête', () => {
      const p = programmer('critical');
      assert.equal(p.fin - p.debut, 8);
    });

    it('alterne deux tonalités de nombreuses fois, comme une sirène', () => {
      const p = programmer('critical');
      assert.ok(p.frequences.length >= 20, `seulement ${p.frequences.length} tonalités`);

      const distinctes = new Set(p.frequences);
      assert.equal(distinctes.size, 2, 'un son à une seule fréquence n’attire pas l’attention');
      assert.deepEqual([...distinctes].sort((a, b) => b - a), [988, 740]);
    });

    it('utilise un timbre perçant et un volume élevé', () => {
      const p = programmer('critical');
      // La dent de scie est bien plus riche en harmoniques qu'une sinusoïde :
      // à volume égal, elle porte beaucoup plus loin.
      assert.equal(p.timbre, 'sawtooth');
      assert.ok(Math.max(...p.gains) >= 0.5, 'volume trop faible pour un open space');
    });

    it('pulse au lieu de tenir une note continue', () => {
      const p = programmer('critical');
      const niveaux = new Set(p.gains.map((g) => Math.round(g * 100)));
      assert.ok(niveaux.size >= 2, 'aucune pulsation : le son est plat');
    });
  });

  it('garde l’avertissement bref et plus discret que le critique', () => {
    const critique = programmer('critical');
    const avertissement = programmer('warning');

    assert.ok(
      avertissement.fin - avertissement.debut < (critique.fin - critique.debut) / 2,
      'un avertissement ne doit pas interrompre le plateau',
    );
    assert.ok(Math.max(...avertissement.gains) < Math.max(...critique.gains));
  });
});

describe('encodage WAV', () => {
  it('produit un en-tête RIFF/WAVE valide et la bonne taille', async () => {
    const echantillons = new Float32Array(1000);
    const blob = sonModule.encodeWav(echantillons, 22_050);
    const octets = new Uint8Array(await blob.arrayBuffer());
    const texte = (debut: number, fin: number) => String.fromCharCode(...octets.slice(debut, fin));

    assert.equal(texte(0, 4), 'RIFF');
    assert.equal(texte(8, 12), 'WAVE');
    assert.equal(texte(36, 40), 'data');
    // 44 octets d'en-tête + 2 octets par échantillon (PCM 16 bits mono).
    assert.equal(blob.size, 44 + 1000 * 2);
    assert.equal(blob.type, 'audio/wav');
  });

  it('écrête les valeurs hors bornes plutôt que de produire un craquement', async () => {
    const blob = sonModule.encodeWav(new Float32Array([2, -2]), 22_050);
    const vue = new DataView(await blob.arrayBuffer());
    assert.equal(vue.getInt16(44, true), 32767);
    assert.equal(vue.getInt16(46, true), -32768);
  });
});

// --- La mécanique de déclenchement -------------------------------------------

describe('AlertSiren', () => {
  /**
   * Le cas de l'écran d'open space : personne n'interagit jamais avec la page.
   * Un élément `<audio>` s'appuie sur l'engagement mémorisé par site, ce qui
   * permet de sonner sans le moindre clic — contrairement à un AudioContext,
   * qui exige une interaction dans chaque page chargée.
   */
  it('est prête sans aucune interaction quand le navigateur l’autorise', async () => {
    const sirene = new AlertSiren();
    assert.equal(await sirene.prepare(), 'ready');
  });

  it('joue la sirène demandée', async () => {
    const sirene = new AlertSiren();
    await sirene.prepare();

    assert.equal(sirene.play('critical'), true);
    await new Promise((r) => setTimeout(r, 5));

    const element = FauxAudio.instances[0]!;
    // La première lecture est le silence de test, la seconde la sirène.
    assert.equal(element.lectures.length, 2);
    assert.notEqual(element.lectures[1], element.lectures[0]);
  });

  it('interrompt la sirène en cours plutôt que de superposer deux sons', async () => {
    const sirene = new AlertSiren();
    await sirene.prepare();
    const element = FauxAudio.instances[0]!;
    const pausesAvant = element.pauses;

    sirene.play('warning');
    sirene.play('critical');
    assert.ok(element.pauses > pausesAvant, 'la lecture précédente aurait dû être interrompue');
  });

  it('peut être coupée à la demande', async () => {
    const sirene = new AlertSiren();
    await sirene.prepare();
    sirene.play('critical');

    sirene.stop();
    assert.equal(FauxAudio.instances[0]!.currentTime, 0);
  });

  describe('quand le navigateur refuse la lecture automatique', () => {
    beforeEach(() => {
      FauxAudio.autorise = false;
    });

    it('signale que le son est bloqué au lieu d’échouer en silence', async () => {
      const sirene = new AlertSiren();
      assert.equal(await sirene.prepare(), 'blocked');
      assert.equal(sirene.state, 'blocked');
    });

    /**
     * Régression : les écouteurs de geste doivent être posés de façon
     * synchrone. Les enchaîner derrière une promesse les rendait tributaires de
     * sa résolution — et une promesse restée en attente suffisait à ce
     * qu'aucun clic ne débloque plus jamais rien.
     */
    it('pose ses écouteurs immédiatement, sans attendre quoi que ce soit', () => {
      const faux = globalThis.document as unknown as ReturnType<typeof fauxDocument>;
      const sirene = new AlertSiren();

      sirene.armOnFirstGesture();
      assert.ok(faux.nombreEcouteurs() > 0, 'aucun écouteur posé : un clic ne pourrait rien débloquer');
    });

    it('se débloque au premier geste et prévient l’interface', async () => {
      const faux = globalThis.document as unknown as ReturnType<typeof fauxDocument>;
      const sirene = new AlertSiren();
      const etats: string[] = [];

      sirene.onStateChange((state) => etats.push(state));
      sirene.armOnFirstGesture();
      await sirene.prepare();

      // L'utilisateur clique : le navigateur autorise désormais la lecture.
      FauxAudio.autorise = true;
      faux.declencher('pointerdown');
      await new Promise((r) => setTimeout(r, 10));

      assert.equal(sirene.state, 'ready');
      assert.ok(etats.includes('ready'), `états observés : ${etats.join(', ')}`);
      assert.equal(faux.nombreEcouteurs(), 0, 'les écouteurs auraient dû être retirés');
    });

    it('reste à l’écoute si le geste ne suffit pas', async () => {
      const faux = globalThis.document as unknown as ReturnType<typeof fauxDocument>;
      const sirene = new AlertSiren();

      sirene.armOnFirstGesture();
      faux.declencher('pointerdown');
      await new Promise((r) => setTimeout(r, 10));

      assert.ok(faux.nombreEcouteurs() > 0, 'abandonner après un geste raté condamnerait le son');
    });

    it('repasse à « bloqué » si une lecture est refusée en cours de route', async () => {
      const sirene = new AlertSiren();
      FauxAudio.autorise = true;
      await sirene.prepare();
      assert.equal(sirene.state, 'ready');

      // Le navigateur se met à refuser : l'interface ne doit pas continuer à
      // prétendre que la surveillance sonore fonctionne.
      FauxAudio.autorise = false;
      sirene.play('critical');
      await new Promise((r) => setTimeout(r, 10));

      assert.equal(sirene.state, 'blocked');
    });
  });
});
