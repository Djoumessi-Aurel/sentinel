import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PATTERNS, SAMPLE_RATE, encodeWav, renderSiren, synthesize } from '../lib/siren-sound.ts';

/**
 * Tests du signal sonore.
 *
 * La synthèse étant faite en JavaScript pur, on peut vérifier le **son
 * réellement produit** — sa durée, ses fréquences, son amplitude — et non
 * seulement une suite d'appels d'API. Ce sont ces propriétés qui décident si une
 * alerte critique s'entend à l'autre bout d'un open space ou passe pour une
 * notification de téléphone.
 */

/**
 * Estime la fréquence d'une portion de signal en comptant ses passages par
 * zéro : deux par période.
 */
function estimerFrequence(samples: Float32Array, debut: number, fin: number, sampleRate: number): number {
  let passages = 0;
  for (let index = debut + 1; index < fin; index += 1) {
    const precedent = samples[index - 1] ?? 0;
    const courant = samples[index] ?? 0;
    if ((precedent < 0 && courant >= 0) || (precedent >= 0 && courant < 0)) passages += 1;
  }
  return (passages / 2 / ((fin - debut) / sampleRate));
}

const crete = (samples: Float32Array) => samples.reduce((max, v) => Math.max(max, Math.abs(v)), 0);

describe('synthèse de la sirène', () => {
  describe('alerte critique', () => {
    const pattern = PATTERNS.critical;
    const samples = synthesize(pattern);

    it('dure assez longtemps pour faire lever la tête', () => {
      assert.equal(samples.length, Math.ceil(8 * SAMPLE_RATE));
    });

    it('atteint un volume élevé', () => {
      // Tolérance : l'enveloppe module légèrement l'amplitude crête.
      assert.ok(crete(samples) > pattern.gain * 0.9, `crête ${crete(samples)}, attendu ≈ ${pattern.gain}`);
      assert.ok(crete(samples) <= 1, 'le signal ne doit jamais saturer');
    });

    /**
     * Le cœur de l'effet « sirène » : deux tonalités qui alternent. Un son à
     * fréquence unique se fond dans le bruit ambiant en quelques secondes.
     */
    it('alterne bien les deux tonalités annoncées', () => {
      const step = Math.floor(pattern.step * SAMPLE_RATE);
      // On mesure au cœur de chaque palier, à l'écart des transitions.
      const marge = Math.floor(step * 0.2);
      const premier = estimerFrequence(samples, marge, step - marge, SAMPLE_RATE);
      const second = estimerFrequence(samples, step + marge, 2 * step - marge, SAMPLE_RATE);

      assert.ok(Math.abs(premier - pattern.tones[0]) < 40, `premier ton mesuré à ${premier.toFixed(0)} Hz`);
      assert.ok(Math.abs(second - pattern.tones[1]) < 40, `second ton mesuré à ${second.toFixed(0)} Hz`);
      assert.ok(Math.abs(premier - second) > 150, 'les deux tons doivent être nettement distincts');
    });

    it('démarre et se termine en douceur, sans claquement', () => {
      assert.ok(Math.abs(samples[0] ?? 0) < 0.05, 'attaque trop brutale');
      assert.ok(Math.abs(samples[samples.length - 1] ?? 0) < 0.05, 'coupure trop brutale');
    });

    it('pulse au lieu de tenir une note continue', () => {
      // On compare l'amplitude juste après un changement de ton (creux de la
      // pulsation) à celle atteinte un peu plus tard.
      const step = Math.floor(pattern.step * SAMPLE_RATE);
      const creux = crete(samples.slice(step, step + Math.floor(step * 0.1)));
      const sommet = crete(samples.slice(step + Math.floor(step * 0.5), step + Math.floor(step * 0.9)));
      assert.ok(sommet > creux * 1.15, `aucune pulsation perceptible (${creux.toFixed(2)} → ${sommet.toFixed(2)})`);
    });
  });

  it('garde l’avertissement plus court et plus discret que le critique', () => {
    const critique = synthesize(PATTERNS.critical);
    const avertissement = synthesize(PATTERNS.warning);

    assert.ok(avertissement.length < critique.length / 2, 'un avertissement ne doit pas interrompre le plateau');
    assert.ok(crete(avertissement) < crete(critique), 'il doit aussi être moins fort');
  });

  it('produit un signal identique à chaque appel', () => {
    const a = synthesize(PATTERNS.warning);
    const b = synthesize(PATTERNS.warning);
    assert.deepEqual([...a.slice(0, 500)], [...b.slice(0, 500)]);
  });
});

describe('encodage WAV', () => {
  it('produit un en-tête RIFF/WAVE valide et la bonne taille', async () => {
    const blob = encodeWav(new Float32Array(1000));
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
    const vue = new DataView(await encodeWav(new Float32Array([2, -2])).arrayBuffer());
    assert.equal(vue.getInt16(0 + 44, true), 32767);
    assert.equal(vue.getInt16(2 + 44, true), -32768);
  });

  it('rend une sirène complète de taille cohérente', () => {
    const blob = renderSiren('critical');
    assert.equal(blob.size, 44 + Math.ceil(8 * SAMPLE_RATE) * 2);
  });

  /**
   * La synthèse est faite à chaque chargement de page : elle doit rester
   * imperceptible, faute de quoi elle retarderait l'affichage.
   */
  it('reste instantanée', () => {
    const debut = performance.now();
    renderSiren('critical');
    const duree = performance.now() - debut;
    assert.ok(duree < 200, `synthèse en ${duree.toFixed(0)} ms, trop lente pour un chargement de page`);
  });
});
