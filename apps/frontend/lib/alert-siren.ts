'use client';

import type { AlertSeverity } from '@sentinel/shared-types';

/**
 * Sirène d'alerte.
 *
 * Le son doit s'entendre à l'autre bout d'un open space et durer assez pour
 * qu'on lève la tête : une notification brève et douce se confond avec un
 * téléphone et ne provoque aucune réaction. On produit donc un deux-tons
 * alterné, en dents de scie — timbre volontairement dur, bien plus perçant
 * qu'une sinusoïde à volume égal — répété plusieurs secondes.
 *
 * Tout est synthétisé par l'API Web Audio : aucun fichier à héberger, aucune
 * requête réseau, et le son reste disponible même si le backend tombe — ce qui
 * est précisément le moment où on en a besoin.
 *
 * ## Politique de lecture automatique
 *
 * Les navigateurs interdisent de démarrer un son sans interaction préalable, et
 * aucune API ne permet de s'en affranchir. Deux pièges, tous deux rencontrés :
 *
 * 1. **Ne jamais attendre `resume()` hors d'un geste utilisateur.** La promesse
 *    peut ne jamais se résoudre. Tout code enchaîné derrière — y compris la
 *    pose des écouteurs de geste — ne s'exécute alors jamais, et plus aucun clic
 *    ne peut débloquer quoi que ce soit.
 * 2. **Ne pas conserver un contexte créé hors geste.** Chrome le marque comme
 *    bloqué, et le `resume()` d'un clic ultérieur ne le réveille pas toujours.
 *    On le referme donc et on en recrée un propre au premier geste.
 */

export type SirenState =
  /** L'API Web Audio n'existe pas dans ce navigateur. */
  | 'unavailable'
  /** Le navigateur exige un geste utilisateur avant de laisser jouer un son. */
  | 'blocked'
  /** Prête à sonner. */
  | 'ready';

interface Pattern {
  /** Durée totale, en secondes. */
  readonly duration: number;
  /** Durée d'une tonalité, en secondes. */
  readonly step: number;
  /** Les deux fréquences alternées, en hertz. */
  readonly tones: readonly [number, number];
  readonly gain: number;
  readonly wave: OscillatorType;
}

const PATTERNS: Record<AlertSeverity, Pattern> = {
  // Critique : deux-tons type sirène, 8 secondes, fort. C'est l'état qui doit
  // faire lever la tête à tout le plateau.
  critical: { duration: 8, step: 0.32, tones: [988, 740], gain: 0.5, wave: 'sawtooth' },
  // Avertissement : plus court et plus doux — il informe, il n'interrompt pas.
  warning: { duration: 2.2, step: 0.5, tones: [660, 550], gain: 0.28, wave: 'triangle' },
};

/** Gestes considérés comme une interaction par les navigateurs. */
const GESTURES = ['pointerdown', 'mousedown', 'keydown', 'touchstart'] as const;

export class AlertSiren {
  private context: AudioContext | null = null;
  private stopCurrent: (() => void) | null = null;
  private readonly observers = new Set<(state: SirenState) => void>();
  private detachStateChange: (() => void) | null = null;

  /** Le navigateur sait-il produire du son ? */
  get supported(): boolean {
    return typeof window !== 'undefined' && typeof window.AudioContext !== 'undefined';
  }

  get state(): SirenState {
    if (!this.supported) return 'unavailable';
    if (!this.context) return 'blocked';
    return this.context.state === 'running' ? 'ready' : 'blocked';
  }

  /** S'abonner aux changements d'état, pour que l'interface reflète la réalité. */
  onStateChange(observer: (state: SirenState) => void): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  private notify(): void {
    const state = this.state;
    for (const observer of this.observers) observer(state);
  }

  /**
   * Tente de débloquer le son. **Synchrone et sans attente** : rien n'est
   * enchaîné derrière une promesse qui pourrait ne jamais se résoudre.
   *
   * @param fromGesture true si l'appel provient d'un vrai geste utilisateur.
   */
  tryUnlock(fromGesture = false): SirenState {
    if (!this.supported) return 'unavailable';

    if (!this.context) {
      this.context = new AudioContext();
      // Chrome peut réveiller le contexte de lui-même dès que la page gagne une
      // interaction : on écoute la transition plutôt que de la deviner.
      const onChange = () => this.notify();
      this.context.addEventListener('statechange', onChange);
      this.detachStateChange = () => this.context?.removeEventListener('statechange', onChange);
    }

    if (this.context.state === 'running') return 'ready';

    if (!fromGesture) {
      // Contexte suspendu créé hors geste : Chrome le considère bloqué, et le
      // `resume()` d'un clic ultérieur ne le réveille pas de façon fiable. On
      // s'en débarrasse pour repartir d'un contexte neuf au premier geste.
      this.discardContext();
      return 'blocked';
    }

    // Sous geste utilisateur : `resume()` est appelé sans `await` préalable,
    // afin de rester dans la tâche qui porte l'interaction.
    void this.context.resume().catch(() => undefined);
    this.primeWithSilentBuffer();
    return this.state;
  }

  /**
   * Joue un échantillon muet. Recette classique de déblocage : certains
   * navigateurs ne basculent réellement le contexte en lecture qu'après une
   * première source effectivement démarrée.
   */
  private primeWithSilentBuffer(): void {
    if (!this.context) return;
    try {
      const buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.context.destination);
      source.start(0);
    } catch {
      // Sans effet si le navigateur refuse : la sirène restera simplement bloquée.
    }
  }

  private discardContext(): void {
    this.detachStateChange?.();
    this.detachStateChange = null;
    const context = this.context;
    this.context = null;
    void context?.close().catch(() => undefined);
  }

  /**
   * Débloque le son au **premier geste de l'utilisateur**, quel qu'il soit.
   *
   * Les écouteurs sont posés **immédiatement et de façon synchrone** : les
   * enchaîner derrière une promesse les rendrait dépendants de sa résolution,
   * et un `resume()` resté en attente suffirait à ce qu'aucun clic ne débloque
   * jamais rien.
   *
   * Retourne une fonction de désinscription.
   */
  armOnFirstGesture(onState?: (state: SirenState) => void): () => void {
    if (typeof document === 'undefined') return () => undefined;

    let detached = false;
    const detach = () => {
      if (detached) return;
      detached = true;
      for (const name of GESTURES) document.removeEventListener(name, handle, true);
    };

    const handle = () => {
      const state = this.tryUnlock(true);
      onState?.(state);
      this.notify();
      // On reste à l'écoute tant que ce n'est pas gagné : un geste peut survenir
      // trop tôt, ou le navigateur exiger davantage qu'une interaction.
      if (state === 'ready') detach();
    };

    // Phase de capture : le geste est vu même si un composant interrompt la
    // propagation de l'événement.
    for (const name of GESTURES) document.addEventListener(name, handle, true);
    return detach;
  }

  /** Émet la sirène correspondant à la gravité. Sans effet si le son est bloqué. */
  play(severity: AlertSeverity): boolean {
    if (this.state !== 'ready' || !this.context) return false;

    const context = this.context;
    const pattern = PATTERNS[severity];

    // Une alerte critique interrompt une alerte en cours : deux sirènes
    // superposées ne s'entendent plus, et c'est la plus grave qui compte.
    this.stop();

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = pattern.wave;

    const start = context.currentTime;
    const end = start + pattern.duration;

    // Alternance des deux tons sur toute la durée.
    let at = start;
    let high = true;
    while (at < end) {
      oscillator.frequency.setValueAtTime(high ? pattern.tones[0] : pattern.tones[1], at);
      at += pattern.step;
      high = !high;
    }

    // Enveloppe : montée franche, puis pulsation à chaque changement de ton pour
    // éviter l'accoutumance à un son continu, et extinction douce à la fin pour
    // ne pas produire de claquement.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(pattern.gain, start + 0.03);
    for (let pulse = start + pattern.step; pulse < end - pattern.step; pulse += pattern.step) {
      gain.gain.setValueAtTime(pattern.gain * 0.55, pulse);
      gain.gain.linearRampToValueAtTime(pattern.gain, pulse + pattern.step * 0.35);
    }
    gain.gain.setValueAtTime(pattern.gain, end - 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end);

    const cleanup = () => {
      try {
        oscillator.stop();
      } catch {
        // Déjà arrêté : rien à faire.
      }
      oscillator.disconnect();
      gain.disconnect();
      if (this.stopCurrent === cleanup) this.stopCurrent = null;
    };

    oscillator.onended = cleanup;
    this.stopCurrent = cleanup;
    return true;
  }

  /** Coupe la sirène en cours (bouton « Couper la sirène »). */
  stop(): void {
    this.stopCurrent?.();
  }
}

/** Instance unique : une seule sirène par onglet, quel que soit l'écran affiché. */
let shared: AlertSiren | null = null;

export function getSiren(): AlertSiren {
  shared ??= new AlertSiren();
  return shared;
}
