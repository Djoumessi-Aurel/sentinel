#!/usr/bin/env node
/**
 * Réaligne les couleurs d'affichage déjà stockées sur les valeurs par défaut
 * courantes de `@sentinel/shared-types`.
 *
 * Nécessaire parce que la configuration est **copiée**, jamais lue en cascade
 * (docs/CONFIG_MANAGEMENT.md §1) : changer les valeurs par défaut dans le code
 * n'a aucun effet sur les applications déjà déclarées, par conception.
 *
 * Le script ne remplace que les configurations tenant encore **exactement** un
 * jeu de valeurs par défaut d'une version antérieure. Une palette retouchée à la
 * main est reconnue comme telle et laissée intacte : écraser le réglage d'un
 * utilisateur sous prétexte de mise à jour serait le contraire du but.
 *
 *   node scripts/refresh-display-colors.mjs [--dry-run]
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';
import { DEFAULT_DISPLAY_COLORS } from '@sentinel/shared-types';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Chargement du .env racine (même fichier unique que le reste des outils).
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at === -1) continue;
    const key = trimmed.slice(0, at).trim();
    if (process.env[key] === undefined) {
      process.env[key] = trimmed.slice(at + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
}

/**
 * Palettes livrées par les versions précédentes. Une configuration qui en tient
 * une à l'identique n'a jamais été personnalisée.
 */
const PREVIOUS_DEFAULTS = [
  {
    label: 'thème sombre initial',
    colors: {
      background: '#0f172a',
      text: '#e2e8f0',
      levelColors: {
        TRACE: '#64748b',
        DEBUG: '#94a3b8',
        INFO: '#38bdf8',
        WARN: '#fbbf24',
        ERROR: '#f87171',
        FATAL: '#ef4444',
        UNKNOWN: '#cbd5e1',
      },
    },
  },
];

const DRY_RUN = process.argv.includes('--dry-run');
const prisma = new PrismaClient();

/** Comparaison structurelle, indépendante de l'ordre des clés. */
const sameColors = (a, b) => {
  if (!a || !b || a.background !== b.background || a.text !== b.text) return false;
  const left = a.levelColors ?? {};
  const right = b.levelColors ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
};

const matchesAPreviousDefault = (colors) =>
  PREVIOUS_DEFAULTS.find((candidate) => sameColors(colors, candidate.colors)) ?? null;

async function main() {
  let updated = 0;
  let preserved = 0;

  const global = await prisma.globalConfig.findUnique({ where: { id: 'singleton' } });
  if (global) {
    const previous = matchesAPreviousDefault(global.displayColors);
    if (sameColors(global.displayColors, DEFAULT_DISPLAY_COLORS)) {
      console.log('  = configuration globale : déjà à jour');
    } else if (previous) {
      if (!DRY_RUN) {
        await prisma.globalConfig.update({
          where: { id: 'singleton' },
          data: { displayColors: DEFAULT_DISPLAY_COLORS, updatedBy: 'refresh-display-colors' },
        });
      }
      updated += 1;
      console.log(`  + configuration globale : ${previous.label} → palette courante`);
    } else {
      preserved += 1;
      console.log('  ~ configuration globale : personnalisée, conservée');
    }
  }

  const configs = await prisma.appConfig.findMany({
    include: { application: { select: { name: true } } },
  });

  for (const config of configs) {
    if (sameColors(config.displayColors, DEFAULT_DISPLAY_COLORS)) continue;

    const previous = matchesAPreviousDefault(config.displayColors);
    if (!previous) {
      preserved += 1;
      console.log(`  ~ ${config.application.name} : palette personnalisée, conservée`);
      continue;
    }

    if (!DRY_RUN) {
      await prisma.appConfig.update({
        where: { applicationId: config.applicationId },
        data: { displayColors: DEFAULT_DISPLAY_COLORS, updatedBy: 'refresh-display-colors' },
      });
    }
    updated += 1;
    console.log(`  + ${config.application.name} : ${previous.label} → palette courante`);
  }

  console.log(
    `\n${DRY_RUN ? '[simulation] ' : ''}${updated} configuration(s) réalignée(s), ${preserved} conservée(s) car personnalisée(s).`,
  );
  if (preserved > 0) {
    console.log("Pour aligner aussi les palettes personnalisées, passer par l'écran « Généraliser ».");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
