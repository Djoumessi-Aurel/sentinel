import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

/**
 * Tests de la **mécanique de déclenchement** de la sirène.
 *
 * Le signal sonore lui-même est couvert par `siren-sound.test.mts`. Ici on
 * vérifie ce qui a réellement cassé en conditions normales : la détection de la
 * politique de lecture automatique et le déblocage au premier geste.
 */

/** Élément `<audio>` factice, dont on pilote l'autorisation de lecture. */
class FauxAudio {
  /** Le navigateur autorise-t-il la lecture automatique ? */
  static autorise = true;
  /** Nom de l'erreur levée en cas de refus. */
  static erreur = 'NotAllowedError';
  static instances: FauxAudio[] = [];

  src = '';
  volume = 1;
  currentTime = 0;
  preload = '';
  readonly lectures: string[] = [];
  tentatives = 0;
  pauses = 0;

  constructor() {
    FauxAudio.instances.push(this);
  }

  async play(): Promise<void> {
    this.tentatives += 1;
    if (!FauxAudio.autorise) {
      const erreur = new Error('lecture refusée');
      erreur.name = FauxAudio.erreur;
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

const patienter = (ms = 40) => new Promise((r) => setTimeout(r, ms));

let AlertSiren: typeof import('../lib/alert-siren.ts').AlertSiren;

before(async () => {
  const globaux = globalThis as Record<string, unknown>;
  globaux['window'] = globalThis;
  globaux['Audio'] = FauxAudio;
  ({ AlertSiren } = await import('../lib/alert-siren.ts'));
});

beforeEach(() => {
  FauxAudio.autorise = true;
  FauxAudio.erreur = 'NotAllowedError';
  FauxAudio.instances = [];
  (globalThis as Record<string, unknown>)['document'] = fauxDocument();
});

describe('AlertSiren', () => {
  /**
   * Le cas de l'écran d'open space : personne n'interagit jamais avec la page.
   * Un élément `<audio>` peut sonner sans interaction, contrairement à un
   * `AudioContext` qui l'exige à chaque chargement de page.
   */
  it('est prête sans aucune interaction quand le navigateur l’autorise', async () => {
    const sirene = new AlertSiren();
    assert.equal(await sirene.prepare(), 'ready');
    assert.equal(sirene.blockedReason, null);
  });

  /**
   * La préparation doit aboutir **à chaque chargement de page**. Une première
   * version passait par `OfflineAudioContext`, dont Chromium plafonne le nombre
   * d'instances : au-delà, la promesse restait en attente sans lever d'erreur, et
   * le son ne partait plus jamais. La synthèse est désormais synchrone.
   */
  it('se prépare de façon répétée sans jamais rester en attente', async () => {
    for (let essai = 0; essai < 20; essai += 1) {
      const sirene = new AlertSiren();
      const etat = await Promise.race([sirene.prepare(), patienter(500).then(() => 'EN ATTENTE' as const)]);
      assert.equal(etat, 'ready', `préparation bloquée à l’essai ${essai + 1}`);
    }
  });

  it('joue la sirène demandée', async () => {
    const sirene = new AlertSiren();
    await sirene.prepare();
    assert.equal(sirene.play('critical'), true);
    await patienter();

    const element = FauxAudio.instances[0]!;
    // La première lecture est le silence de test, la seconde la sirène.
    assert.equal(element.lectures.length, 2);
    assert.notEqual(element.lectures[1], element.lectures[0]);
  });

  it('interrompt la sirène en cours plutôt que de superposer deux sons', async () => {
    const sirene = new AlertSiren();
    await sirene.prepare();
    const element = FauxAudio.instances[0]!;
    const avant = element.pauses;

    sirene.play('warning');
    sirene.play('critical');
    assert.ok(element.pauses > avant, 'la lecture précédente aurait dû être interrompue');
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
      assert.equal(sirene.blockedReason, 'autoplay');
    });

    /**
     * Régression : les écouteurs de geste doivent être posés de façon synchrone.
     * Les enchaîner derrière une promesse les rendait tributaires de sa
     * résolution — et une promesse restée en attente suffisait à ce qu'aucun
     * clic ne débloque plus jamais rien.
     */
    it('pose ses écouteurs immédiatement, sans attendre quoi que ce soit', () => {
      const faux = globalThis.document as unknown as ReturnType<typeof fauxDocument>;
      new AlertSiren().armOnFirstGesture();
      assert.ok(faux.nombreEcouteurs() > 0, 'aucun écouteur posé : un clic ne pourrait rien débloquer');
    });

    it('se débloque au premier geste et prévient l’interface', async () => {
      const faux = globalThis.document as unknown as ReturnType<typeof fauxDocument>;
      const sirene = new AlertSiren();
      const etats: string[] = [];

      sirene.onStateChange((state) => etats.push(state));
      sirene.armOnFirstGesture();
      await sirene.prepare();

      FauxAudio.autorise = true;
      faux.declencher('pointerdown');
      await patienter();

      assert.equal(sirene.state, 'ready');
      assert.ok(etats.includes('ready'), `états observés : ${etats.join(', ')}`);
      assert.equal(faux.nombreEcouteurs(), 0, 'les écouteurs auraient dû être retirés');
    });

    it('reste à l’écoute si le geste ne suffit pas', async () => {
      const faux = globalThis.document as unknown as ReturnType<typeof fauxDocument>;
      new AlertSiren().armOnFirstGesture();

      faux.declencher('pointerdown');
      await patienter();
      assert.ok(faux.nombreEcouteurs() > 0, 'abandonner après un geste raté condamnerait le son');
    });

    /**
     * Un `AbortError` survient quand une source est remplacée en cours de
     * chargement : incident passager, pas refus. Le confondre avec un refus
     * afficherait à tort que la surveillance sonore est coupée.
     */
    it('réessaie sur un incident passager au lieu de conclure au refus', async () => {
      FauxAudio.erreur = 'AbortError';
      const sirene = new AlertSiren();

      const attente = sirene.prepare();
      setTimeout(() => {
        FauxAudio.autorise = true;
      }, 100);

      assert.equal(await attente, 'ready');
      assert.ok(FauxAudio.instances[0]!.tentatives > 1, 'aucune nouvelle tentative');
    });

    it('repasse à « bloqué » si une lecture est refusée en cours de route', async () => {
      FauxAudio.autorise = true;
      const sirene = new AlertSiren();
      await sirene.prepare();
      assert.equal(sirene.state, 'ready');

      // Le navigateur se met à refuser : l'interface ne doit pas continuer à
      // prétendre que la surveillance sonore fonctionne.
      FauxAudio.autorise = false;
      sirene.play('critical');
      await patienter();

      assert.equal(sirene.state, 'blocked');
    });
  });
});
