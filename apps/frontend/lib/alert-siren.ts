'use client';

import type { AlertSeverity } from '@sentinel/shared-types';

import { SOURCES_SIRENE } from './siren-sound.ts';

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
 * Le son est donc calculé échantillon par échantillon en JavaScript, encodé en
 * WAV, puis joué par un `<audio>`. Aucun fichier à héberger, aucune API audio
 * sollicitée pour le produire, et le son reste disponible même si le backend est
 * tombé — ce qui est précisément le moment où on en a besoin.
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
  /** Nom de la dernière erreur de lecture, pour distinguer refus et incident. */
  private lastErrorName: string | null = null;
  private warned = false;
  private preparing: Promise<SirenState> | null = null;
  private readonly observers = new Set<(state: SirenState) => void>();

  get supported(): boolean {
    return typeof window !== 'undefined' && typeof window.Audio !== 'undefined';
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

    // Fichiers `.wav` servis par le site, et non plus des URL `blob:` produites
    // à la volée.
    //
    // Le son était auparavant synthétisé dans le navigateur à chaque
    // chargement. Cela fonctionnait, mais chaque page repartait de zéro et le
    // navigateur ne voyait qu'une ressource éphémère, sans rapport visible avec
    // le site. Un fichier servi est mis en cache, préchargé, et compte comme une
    // lecture du site pour l'indice d'engagement média que Chromium utilise
    // pour décider d'autoriser une lecture spontanée (docs/FRONTEND.md §3.1).
    //
    // Les fichiers sont produits par `scripts/generer-sons.mjs`, qui appelle le
    // même code de synthèse : il n'existe toujours qu'une seule définition du
    // signal, et les tests continuent de porter dessus.
    for (const [severity, url] of Object.entries(SOURCES_SIRENE.alertes)) {
      this.sources.set(severity as AlertSeverity, url);
    }
    this.silenceUrl ??= SOURCES_SIRENE.silence;

    // Mise en cache anticipée.
    //
    // Les sons vivaient auparavant en mémoire : ils partaient instantanément.
    // Servis en fichiers, ils seraient sinon téléchargés au moment précis de
    // l'alerte — soit le pire moment pour attendre le réseau. On les demande
    // donc dès la préparation, sans bloquer : un échec ici n'empêche rien, la
    // lecture les redemandera.
    for (const url of Object.values(SOURCES_SIRENE.alertes)) {
      void fetch(url, { cache: 'force-cache' }).catch(() => undefined);
    }

    return this.probe();
  }

  /**
   * Teste la lecture automatique en jouant un silence audible-capable : l'élément
   * n'est pas en sourdine, la politique du navigateur s'applique donc vraiment,
   * mais rien ne se fait entendre.
   */
  private async probe(attempt = 1): Promise<SirenState> {
    if (!this.element || !this.silenceUrl) return 'blocked';

    try {
      this.element.src = this.silenceUrl;
      this.element.volume = 1;
      await this.element.play();
      this.element.pause();
      this.element.currentTime = 0;
      this.lastErrorName = null;
      this.setState('ready');
      return 'ready';
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      this.lastErrorName = name;

      // `NotAllowedError` est le seul vrai refus de lecture automatique. Les
      // autres — `AbortError` quand une source est remplacée en cours de
      // chargement, par exemple — sont des incidents passagers : les traiter
      // comme un refus afficherait à tort que le son est coupé.
      if (name !== 'NotAllowedError' && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
        return this.probe(attempt + 1);
      }

      if (!this.warned) {
        this.warned = true;
        // Trace unique : sans elle, un son absent ne laisse aucune explication
        // à qui ouvre la console pour comprendre.
        console.warn(
          `[Sentinel] Sirène bloquée par le navigateur (${name}). ` +
            "Un clic quelconque dans la page l'active, ou autoriser le son pour ce site " +
            'dans les paramètres du navigateur (edge://settings/content/mediaAutoplay, ' +
            'chrome://settings/content/sound).',
        );
      }

      this.setState('blocked');
      return 'blocked';
    }
  }

  /**
   * Réglage du navigateur permettant d'autoriser le son une fois pour toutes.
   *
   * Seule issue déterministe pour un écran d'open space, que personne
   * n'interagit jamais : le navigateur n'accorde la lecture automatique qu'après
   * un engagement suffisant sur le site, engagement qui ne peut pas se
   * construire tant qu'aucun son n'a jamais été joué.
   */
  get browserSoundSetting(): { label: string; url: string } {
    const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    if (agent.includes('Edg/')) {
      return { label: 'Microsoft Edge', url: 'edge://settings/content/mediaAutoplay' };
    }
    if (agent.includes('Firefox/')) {
      return { label: 'Firefox', url: 'about:preferences#privacy' };
    }
    return { label: 'Google Chrome', url: 'chrome://settings/content/sound' };
  }

  /**
   * Pourquoi le son est bloqué. `autoplay` désigne un refus formel du
   * navigateur, qui ne se lève que par une interaction ou par un réglage du
   * navigateur lui-même.
   */
  get blockedReason(): 'autoplay' | 'other' | null {
    if (this.currentState !== 'blocked') return null;
    return this.lastErrorName === 'NotAllowedError' ? 'autoplay' : 'other';
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
