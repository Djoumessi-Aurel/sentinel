#!/usr/bin/env node
/**
 * Écrit les sirènes sous forme de fichiers `.wav` servis statiquement.
 *
 * Elles étaient jusqu'ici synthétisées dans le navigateur puis jouées depuis une
 * URL `blob:`. Le son fonctionnait, mais restait soumis à la politique de
 * lecture automatique : il fallait un clic, ou autoriser le site à la main.
 * L'hypothèse à vérifier est qu'un `blob:` n'alimente pas l'indice
 * d'engagement média que Chromium utilise pour décider d'autoriser une lecture
 * spontanée, là où un fichier servi par le site le ferait.
 *
 * Le signal lui-même n'est **pas réécrit** : ce script importe le module utilisé
 * par l'interface. Deux implémentations du même son finiraient par diverger, et
 * on écouterait alors autre chose que ce que les tests vérifient.
 *
 * Lancé automatiquement avant `next dev` et `next build` — les fichiers produits
 * ne sont donc pas versionnés, et ne peuvent pas se désynchroniser du code.
 *
 * Usage : node scripts/generer-sons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PATTERNS, SOURCES_SIRENE, renderSilence, renderSiren } from '../apps/frontend/lib/siren-sound.ts';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SORTIE = join(RACINE, 'apps/frontend/public/sons');

/**
 * Noms de fichiers, lus dans le module partagé : ce script et l'interface
 * désignent ainsi forcément les mêmes.
 */
const nomDeFichier = (url) => url.replace('/sons/', '');

const enOctets = async (blob) => Buffer.from(await blob.arrayBuffer());

mkdirSync(SORTIE, { recursive: true });

for (const [gravite, url] of Object.entries(SOURCES_SIRENE.alertes)) {
  const fichier = nomDeFichier(url);
  const octets = await enOctets(renderSiren(gravite));
  writeFileSync(join(SORTIE, fichier), octets);
  const { duration, tones } = PATTERNS[gravite];
  console.log(`  ${fichier.padEnd(26)} ${duration}s  ${tones.join('/')} Hz  ${Math.round(octets.length / 1024)} Ko`);
}

// Un silence très court, joué au premier geste de l'utilisateur pour lever le
// blocage de lecture automatique sans rien faire entendre.
const silence = await enOctets(renderSilence());
const nomSilence = nomDeFichier(SOURCES_SIRENE.silence);
writeFileSync(join(SORTIE, nomSilence), silence);
console.log(`  ${nomSilence.padEnd(26)} amorce  ${silence.length} octets`);

console.log(`\nÉcrits dans ${SORTIE}`);
