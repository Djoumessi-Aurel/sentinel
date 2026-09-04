'use client';

import type { AlertSeverity } from '@sentinel/shared-types';

/**
 * Synthèse du signal de la sirène, et encodage en WAV.
 *
 * Le son est rendu **hors ligne** (`OfflineAudioContext`) puis joué par un
 * élément `<audio>`. Ce détour n'est pas gratuit : un `AudioContext` en lecture
 * directe exige une interaction utilisateur **dans chaque page chargée**, alors
 * qu'un élément média bénéficie de l'indice d'engagement du navigateur, qui est
 * mémorisé par site et survit aux rechargements. C'est ce qui permet à un écran
 * d'open space, que personne ne touche jamais, de sonner malgré tout.
 *
 * Le rendu hors ligne, lui, n'est soumis à aucune autorisation : il ne sort pas
 * sur les haut-parleurs, il produit seulement des échantillons.
 */

export interface Pattern {
  /** Durée totale, en secondes. */
  readonly duration: number;
  /** Durée d'une tonalité, en secondes. */
  readonly step: number;
  /** Les deux fréquences alternées, en hertz. */
  readonly tones: readonly [number, number];
  readonly gain: number;
  readonly wave: OscillatorType;
}

export const PATTERNS: Record<AlertSeverity, Pattern> = {
  // Critique : deux-tons type sirène, 8 secondes, fort. C'est l'état qui doit
  // faire lever la tête à tout le plateau.
  critical: { duration: 8, step: 0.32, tones: [988, 740], gain: 0.5, wave: 'sawtooth' },
  // Avertissement : plus court et plus doux — il informe, il n'interrompt pas.
  warning: { duration: 2.2, step: 0.5, tones: [660, 550], gain: 0.28, wave: 'triangle' },
};

/**
 * Suffisant pour une sirène (dont les harmoniques utiles restent sous 10 kHz),
 * et divise par deux le poids du WAV rendu.
 */
export const SAMPLE_RATE = 22_050;

/**
 * Programme l'oscillateur et son enveloppe. Isolé du rendu pour être testable
 * sans navigateur : les tests vérifient le motif programmé, qui est ce qui rend
 * le son perçant et durable.
 */
export function scheduleSiren(context: BaseAudioContext, pattern: Pattern, startAt = 0): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = pattern.wave;

  const end = startAt + pattern.duration;

  // Alternance des deux tons sur toute la durée.
  let at = startAt;
  let high = true;
  while (at < end) {
    oscillator.frequency.setValueAtTime(high ? pattern.tones[0] : pattern.tones[1], at);
    at += pattern.step;
    high = !high;
  }

  // Enveloppe : montée franche, pulsation à chaque changement de ton pour éviter
  // l'accoutumance à un son continu, extinction douce pour ne pas claquer.
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(pattern.gain, startAt + 0.03);
  for (let pulse = startAt + pattern.step; pulse < end - pattern.step; pulse += pattern.step) {
    gain.gain.setValueAtTime(pattern.gain * 0.55, pulse);
    gain.gain.linearRampToValueAtTime(pattern.gain, pulse + pattern.step * 0.35);
  }
  gain.gain.setValueAtTime(pattern.gain, end - 0.12);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  oscillator.connect(gain).connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(end);
}

/** Encode un buffer mono en WAV PCM 16 bits. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const octets = new ArrayBuffer(44 + samples.length * 2);
  const vue = new DataView(octets);

  const texte = (offset: number, valeur: string) => {
    for (let index = 0; index < valeur.length; index += 1) vue.setUint8(offset + index, valeur.charCodeAt(index));
  };

  texte(0, 'RIFF');
  vue.setUint32(4, 36 + samples.length * 2, true);
  texte(8, 'WAVE');
  texte(12, 'fmt ');
  vue.setUint32(16, 16, true); // taille du bloc fmt
  vue.setUint16(20, 1, true); // PCM
  vue.setUint16(22, 1, true); // mono
  vue.setUint32(24, sampleRate, true);
  vue.setUint32(28, sampleRate * 2, true); // octets par seconde
  vue.setUint16(32, 2, true); // alignement de bloc
  vue.setUint16(34, 16, true); // bits par échantillon
  texte(36, 'data');
  vue.setUint32(40, samples.length * 2, true);

  for (let index = 0; index < samples.length; index += 1) {
    // Écrêtage avant conversion : un dépassement produirait un craquement.
    const valeur = Math.max(-1, Math.min(1, samples[index] ?? 0));
    vue.setInt16(44 + index * 2, valeur < 0 ? valeur * 0x8000 : valeur * 0x7fff, true);
  }

  return new Blob([octets], { type: 'audio/wav' });
}

/** Rend la sirène d'une gravité donnée en WAV. */
export async function renderSiren(severity: AlertSeverity): Promise<Blob> {
  const pattern = PATTERNS[severity];
  const contexte = new OfflineAudioContext(1, Math.ceil(pattern.duration * SAMPLE_RATE), SAMPLE_RATE);
  scheduleSiren(contexte, pattern);
  const rendu = await contexte.startRendering();
  return encodeWav(rendu.getChannelData(0), SAMPLE_RATE);
}

/**
 * WAV de silence très court, servant à tester si la lecture automatique est
 * permise. Il n'est pas *muet* au sens du navigateur — l'élément n'est pas en
 * sourdine — donc la politique s'y applique réellement, mais il ne produit
 * aucun son audible.
 */
export function renderSilence(durationSeconds = 0.05): Blob {
  return encodeWav(new Float32Array(Math.ceil(durationSeconds * SAMPLE_RATE)), SAMPLE_RATE);
}
