'use client';

import type { AlertSeverity } from '@sentinel/shared-types';

/**
 * Synthèse du signal de la sirène, et encodage en WAV.
 *
 * Les échantillons sont calculés **directement en JavaScript**, sans passer par
 * l'API Web Audio. Ce n'est pas un choix esthétique : une première version
 * rendait le son via `OfflineAudioContext`, et Chromium plafonne le nombre de
 * contextes audio par processus de rendu. Sur un profil qui enchaîne les
 * chargements de page, la création finissait par ne plus aboutir — sans erreur,
 * sans exception, la promesse restait simplement en attente et le son ne partait
 * jamais. Le calcul direct n'a aucune de ces limites : il est synchrone,
 * déterministe, et testable sans navigateur.
 *
 * Le résultat est encodé en WAV puis joué par un élément `<audio>`, dont la
 * politique de lecture automatique est bien plus favorable que celle d'un
 * `AudioContext` (voir docs/FRONTEND.md §3.1).
 */

export interface Pattern {
  /** Durée totale, en secondes. */
  readonly duration: number;
  /** Durée d'une tonalité, en secondes. */
  readonly step: number;
  /** Les deux fréquences alternées, en hertz. */
  readonly tones: readonly [number, number];
  /** Amplitude crête, entre 0 et 1. */
  readonly gain: number;
  readonly wave: 'sawtooth' | 'triangle';
}

export const PATTERNS: Record<AlertSeverity, Pattern> = {
  // Critique : deux-tons type sirène, 8 secondes, fort. C'est l'état qui doit
  // faire lever la tête à tout le plateau.
  critical: { duration: 8, step: 0.32, tones: [988, 740], gain: 0.5, wave: 'sawtooth' },
  // Avertissement : plus court et plus doux — il informe, il n'interrompt pas.
  warning: { duration: 2.2, step: 0.5, tones: [660, 550], gain: 0.28, wave: 'triangle' },
};

/**
 * Suffisant pour une sirène, dont les harmoniques utiles restent bien en deçà de
 * la limite de Nyquist à cette fréquence, et divise par deux le poids du WAV.
 */
export const SAMPLE_RATE = 22_050;

/** Attaque et extinction, en secondes : évitent le claquement en début et fin. */
const ATTACK = 0.03;
const RELEASE = 0.12;

/** Forme d'onde à partir d'une phase normalisée dans [0, 1[. */
function waveform(kind: Pattern['wave'], phase: number): number {
  // Dent de scie : riche en harmoniques, donc bien plus perçante qu'une
  // sinusoïde à volume égal. Triangle : nettement plus douce, pour l'avertissement.
  return kind === 'sawtooth' ? 2 * phase - 1 : 4 * Math.abs(phase - 0.5) - 1;
}

/**
 * Calcule les échantillons de la sirène.
 *
 * La phase est accumulée en continu d'un échantillon à l'autre : la recalculer
 * à partir du temps absolu produirait une discontinuité à chaque changement de
 * tonalité, entendue comme un claquement.
 */
export function synthesize(pattern: Pattern, sampleRate = SAMPLE_RATE): Float32Array {
  const total = Math.ceil(pattern.duration * sampleRate);
  const samples = new Float32Array(total);

  let phase = 0;
  for (let index = 0; index < total; index += 1) {
    const time = index / sampleRate;

    // Alternance des deux tonalités.
    const tone = pattern.tones[Math.floor(time / pattern.step) % 2 === 0 ? 0 : 1];
    phase = (phase + tone / sampleRate) % 1;

    // Enveloppe : attaque, pulsation à chaque changement de ton pour éviter
    // l'accoutumance à un son continu, extinction en fin de motif.
    const positionInStep = (time % pattern.step) / pattern.step;
    let envelope = 0.55 + 0.45 * Math.min(positionInStep / 0.35, 1);

    if (time < ATTACK) envelope *= time / ATTACK;
    const remaining = pattern.duration - time;
    if (remaining < RELEASE) envelope *= Math.max(remaining, 0) / RELEASE;

    samples[index] = waveform(pattern.wave, phase) * pattern.gain * envelope;
  }

  return samples;
}

/** Encode un buffer mono en WAV PCM 16 bits. */
export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Blob {
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

/**
 * Emplacement des fichiers servis, produits par `scripts/generer-sons.mjs`.
 *
 * Déclaré ici, à côté de la synthèse : le générateur et l'interface lisent la
 * même définition. Deux listes de noms de fichiers finiraient par diverger, et
 * l'écart ne se verrait qu'au moment où plus aucun son ne sortirait.
 */
export const SOURCES_SIRENE = {
  alertes: {
    critical: '/sons/alerte-critique.wav',
    warning: '/sons/alerte-avertissement.wav',
  } as Record<AlertSeverity, string>,
  /** Amorce muette, jouée au premier geste pour lever le blocage. */
  silence: '/sons/silence.wav',
} as const;

/** Rend la sirène d'une gravité donnée en WAV. Synchrone : aucun calcul différé. */
export function renderSiren(severity: AlertSeverity): Blob {
  return encodeWav(synthesize(PATTERNS[severity]));
}

/**
 * WAV de silence très court, servant à tester si la lecture automatique est
 * permise. Il n'est pas *muet* au sens du navigateur — l'élément n'est pas en
 * sourdine — donc la politique s'y applique réellement, mais rien ne s'entend.
 */
export function renderSilence(durationSeconds = 0.05): Blob {
  return encodeWav(new Float32Array(Math.ceil(durationSeconds * SAMPLE_RATE)));
}
