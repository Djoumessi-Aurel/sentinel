'use client';

import type { AlertSeverity } from '@sentinel/shared-types';

import { PATTERNS, renderSilence, renderSiren } from './siren-sound.ts';

/**
 * Sirène d'alerte.
 *
 * Le son doit s'entendre à l'autre bout d'un open space et durer assez pour
 * qu'on lève la tête : une notification brève et douce se confond avec un
 * téléphone et ne provoque aucune réaction. D'où un deux-tons alterné, en dents
 * de scie — timbre volontairement dur, bien plus perçant qu'une sinusoïde à
 * volume égal — répété plusieurs secondes.
 *
 * ## Pourquoi un élément `<audio>` et non un `AudioContext` en direct
 *
 * Les deux voies n'obéissent pas à la même politique de lecture automatique :
 *
 * - un `AudioContext` exige une interaction utilisateur **dans chaque page
 *   chargée**. Sur un écran d'open space que personne ne touche jamais, il
 *   reste donc muet indéfiniment, y compris après un simple rechargement ;
 * - un élément média bénéficie de l'indice d'engagement du navigateur, qui est
 *   mémorisé **par site** et survit aux rechargements comme aux redémarrages.
 *   C'est exactement ce qui fait fonctionner l'écran de LTM sans le moindre clic.
 *
 * Le son est donc synthétisé hors ligne (rendu qui, lui, ne demande aucune
 * autorisation), encodé en WAV, puis joué par un `<audio>`. Aucun fichier à
 * héberger, et le son reste disponible même si le backend est tombé — ce qui est
 * précisément le moment où on en a besoin.
 */

export type SirenState =
  /** Le navigateur ne sait pas produire ce son. */
  | 'unavailable'
  /** Le navigateur refuse encore la lecture automatique. */
  | 'blocked'
  /** Prête à sonner. */
  | 'ready';

/** Gestes considérés comme une interaction par les navigateurs. */
const GESTURES = ['pointerdown', 'mousedown', 'keydown', 'touchstart'] as const;

export class AlertSiren {
  private element: HTMLAudioElement | null = null;
  private readonly sources = new Map<AlertSeverity, string>();
  private silenceUrl: string | null = null;
  private currentState: SirenState = 'blocked';
  private preparing: Promise<SirenState> | null = null;
  private readonly observers = new Set<(state: SirenState) => void>();

  get supported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof window.Audio !== 'undefined' &&
      typeof window.OfflineAudioContext !== 'undefined'
    );
  }

  get state(): SirenState {
    return this.currentState;
  }

  /** S'abonner aux changements d'état, pour que l'interface reflète la réalité. */
  onStateChange(observer: (state: SirenState) => void): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  private setState(state: SirenState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    for (const observer of this.observers) observer(state);
  }

  /**
   * Prépare les sons et détermine si la lecture automatique est autorisée.
   *
   * Idempotent : appelable à chaque montage sans re-rendre les WAV.
   */
  async prepare(): Promise<SirenState> {
    if (!this.supported) {
      this.setState('unavailable');
      return 'unavailable';
    }
    this.preparing ??= this.doPrepare();
    return this.preparing;
  }

  private async doPrepare(): Promise<SirenState> {
    this.element ??= new Audio();
    this.element.preload = 'auto';

    // Rendu hors ligne : aucune autorisation requise, on peut le faire au
    // chargement sans rien demander.
    for (const severity of Object.keys(PATTERNS) as AlertSeverity[]) {
      if (!this.sources.has(severity)) {
        this.sources.set(severity, URL.createObjectURL(await renderSiren(severity)));
      }
    }
    this.silenceUrl ??= URL.createObjectURL(renderSilence());

    return this.probe();
  }

  /**
   * Teste la lecture automatique en jouant un silence audible-capable : l'élément
   * n'est pas en sourdine, la politique du navigateur s'applique donc vraiment,
   * mais rien ne se fait entendre.
   */
  private async probe(): Promise<SirenState> {
    if (!this.element || !this.silenceUrl) return 'blocked';

    try {
      this.element.src = this.silenceUrl;
      this.element.volume = 1;
      await this.element.play();
      this.element.pause();
      this.element.currentTime = 0;
      this.setState('ready');
      return 'ready';
    } catch {
      // NotAllowedError : le navigateur exige une interaction. On le signale
      // plutôt que de laisser croire que la surveillance sonore fonctionne.
      this.setState('blocked');
      return 'blocked';
    }
  }

  /**
   * Émet la sirène correspondant à la gravité.
   *
   * Retourne `false` si le son est notoirement bloqué. La lecture elle-même est
   * asynchrone : un refus tardif du navigateur repasse l'état à « bloqué », de
   * sorte que l'interface ne prétende jamais qu'un son a été émis alors qu'il ne
   * l'a pas été.
   */
  play(severity: AlertSeverity): boolean {
    const source = this.sources.get(severity);
    if (!this.element || !source || this.currentState === 'unavailable') return false;

    // Une alerte critique interrompt une alerte en cours : deux sirènes
    // superposées ne s'entendent plus, et c'est la plus grave qui compte.
    this.element.pause();
    this.element.src = source;
    this.element.currentTime = 0;
    this.element.volume = 1;

    void this.element
      .play()
      .then(() => this.setState('ready'))
      .catch(() => this.setState('blocked'));

    return this.currentState === 'ready';
  }

  /** Coupe la sirène en cours (bouton « Couper la sirène »). */
  stop(): void {
    if (!this.element) return;
    this.element.pause();
    this.element.currentTime = 0;
  }

  /**
   * Débloque le son au **premier geste de l'utilisateur**, quel qu'il soit.
   *
   * Les écouteurs sont posés **immédiatement et de façon synchrone**. Les
   * enchaîner derrière une promesse les rendrait tributaires de sa résolution :
   * une tentative de lecture restée en attente suffirait à ce qu'aucun clic ne
   * débloque jamais rien — panne réellement rencontrée.
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
      void this.prepare()
        .then(() => this.probe())
        .then((state) => {
          onState?.(state);
          // On reste à l'écoute tant que ce n'est pas gagné : un geste peut
          // survenir trop tôt, ou le navigateur exiger davantage.
          if (state === 'ready') detach();
        });
    };

    // Phase de capture : le geste est vu même si un composant interrompt la
    // propagation de l'événement.
    for (const name of GESTURES) document.addEventListener(name, handle, true);
    return detach;
  }
}

/** Instance unique : une seule sirène par onglet, quel que soit l'écran affiché. */
let shared: AlertSiren | null = null;

export function getSiren(): AlertSiren {
  shared ??= new AlertSiren();
  return shared;
}
