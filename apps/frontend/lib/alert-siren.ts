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
  /** Durée d'un tonalité, en secondes. */
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

export class AlertSiren {
  private context: AudioContext | null = null;
  private stopCurrent: (() => void) | null = null;

  /** Le navigateur sait-il produire du son ? */
  get supported(): boolean {
    return typeof window !== 'undefined' && typeof window.AudioContext !== 'undefined';
  }

  get state(): SirenState {
    if (!this.supported) return 'unavailable';
    if (!this.context) return 'blocked';
    return this.context.state === 'running' ? 'ready' : 'blocked';
  }

  /**
   * Autorise le son. **Doit être appelée depuis un gestionnaire d'événement
   * utilisateur** : sans geste préalable, tous les navigateurs suspendent le
   * contexte audio, et la sirène échouerait en silence — le pire comportement
   * possible pour un outil de supervision.
   */
  async unlock(): Promise<SirenState> {
    if (!this.supported) return 'unavailable';

    this.context ??= new AudioContext();
    if (this.context.state !== 'running') {
      try {
        await this.context.resume();
      } catch {
        return 'blocked';
      }
    }
    return this.context.state === 'running' ? 'ready' : 'blocked';
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

  /** Coupe la sirène en cours (bouton « Couper le son »). */
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
