/**
 * Capture les écrans de l'application pour le guide d'utilisation.
 *
 * Largeur de fenêtre : 1280 px. En dessous, les tableaux à six colonnes replient leurs cellules et
 * les captures ne montrent plus la mise en page réelle ; au-delà, le texte devient trop petit une
 * fois l'image réduite à la largeur utile d'une page A4 (16 cm).
 *
 * Prérequis : backend et interface démarrés, base de démonstration alimentée.
 *
 * Usage :
 *   node outils/capturer-ecrans.mjs
 *
 * Le navigateur est cherché dans plusieurs installations possibles, `playwright` d'abord puis
 * `patchright`. Un chemin explicite peut être imposé par la variable PILOTE_NAVIGATEUR — utile sur
 * un poste où aucune des racines connues n'existe.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SORTIE = join(RACINE, 'captures');

const BASE = 'http://localhost:3000';
const LARGEUR = 1280;

const COMPTES = {
  admin: { username: 'sentineladmin', password: 'sentinel-admin-dev-2026' },
  lecteur: { username: 'jkamga', password: 'peu importe en mode dev' },
  /** Un compte nominatif, pour illustrer l'appairage de la double authentification. */
  superviseur: { username: 'ctchoua', password: 'peu importe en mode dev' },
};

/** Personne de l'annuaire fictif ajoutée le temps des captures. */
const LECTEUR_DEMO = { fragment: 'kamga', identifiant: 'jkamga' };

// --- Résolution du navigateur ------------------------------------------------

function resoudreNavigateur() {
  const racines = [];
  if (process.env.PILOTE_NAVIGATEUR) racines.push(process.env.PILOTE_NAVIGATEUR);
  racines.push(RACINE + '/');

  // Les extensions VS Code embarquent parfois patchright ; le dossier de version change à chaque
  // mise à jour, on prend donc la plus récente plutôt qu'une version figée.
  for (const base of [join(homedir(), '.vscode/extensions'), join(homedir(), '.vscode-server/extensions')]) {
    if (!existsSync(base)) continue;
    const dossiers = readdirSync(base)
      .filter((d) => d.startsWith('danielsanmedium.dscodegpt-'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const dernier = dossiers[dossiers.length - 1];
    if (dernier) racines.push(join(base, dernier, 'standalone') + '/');
  }

  for (const racine of racines) {
    for (const paquet of ['playwright', 'patchright']) {
      try {
        const mod = createRequire(racine)(paquet);
        const chromium = mod?.chromium ?? mod?.default?.chromium;
        if (chromium) return { chromium, origine: `${paquet} (${racine})` };
      } catch {
        /* racine suivante */
      }
    }
  }
  throw new Error(`Aucun pilote trouvé. Racines explorées :\n  ${racines.join('\n  ')}`);
}

// --- Écrans ------------------------------------------------------------------
//
// Un écran = un fichier. La hauteur s'ajuste au contenu, plafonnée : une hauteur fixe laisserait du
// vide sous les écrans courts, et une capture pleine page rendrait les écrans longs illisibles une
// fois réduits à la largeur d'une page.

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Générateur de codes TOTP, repris du backend compilé.
 *
 * Sert uniquement à photographier un appairage réel. Absent tant que le backend
 * n'est pas compilé : les captures de double authentification sont alors
 * simplement omises, plutôt que d'arrêter tout le reste.
 */
const genererCode = (() => {
  try {
    return createRequire(import.meta.url)(join(RACINE, 'apps/backend/dist/auth/totp.js')).genererCode;
  } catch {
    return null;
  }
})();

async function main() {
  const { chromium, origine } = resoudreNavigateur();
  console.log(`Pilote : ${origine}`);
  mkdirSync(SORTIE, { recursive: true });

  const navigateur = await chromium.launch({
    headless: true,
    channel: 'chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const contexte = await navigateur.newContext({
    viewport: { width: LARGEUR, height: 900 },
    locale: 'fr-FR',
    deviceScaleFactor: 2,
  });
  const page = await contexte.newPage();

  const capturer = async (nom, hauteurMax = 900) => {
    await attendre(700);
    // Hauteur du contenu réel, et non `body.scrollHeight` : la mise en page
    // impose une hauteur minimale d'un écran, ce qui laissait une large bande
    // vide sous les pages courtes.
    const hauteur = await page.evaluate(() => {
      const principal = document.querySelector('main');
      if (!principal) return document.body.scrollHeight;
      return Math.ceil(principal.getBoundingClientRect().bottom + window.scrollY + 24);
    });
    await page.setViewportSize({ width: LARGEUR, height: Math.min(Math.max(hauteur, 400), hauteurMax) });
    await attendre(400);
    const fichier = join(SORTIE, `${nom}.png`);
    await page.screenshot({ path: fichier });
    console.log(`  ${nom}.png`);
  };

  const aller = async (chemin) => {
    await page.goto(`${BASE}${chemin}`, { waitUntil: 'networkidle' });
    await attendre(900);
  };

  // La limitation est de cinq connexions par minute : on attend la fenêtre plutôt que d'échouer.
  const connecter = async ({ username, password }) => {
    for (let essai = 0; essai < 3; essai += 1) {
      await aller('/login');
      await page.fill('#username', username);
      await page.fill('#password', password);
      await page.click('button[type=submit]');
      await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => {});
      await attendre(1200);
      if (!new URL(page.url()).pathname.startsWith('/login')) return;
      console.log('    (limite de tentatives atteinte, attente de la fenêtre…)');
      await attendre(62000);
    }
    throw new Error(`Connexion impossible : ${username}`);
  };

  const deconnecter = async () => {
    await page.click('button:has-text("Se déconnecter")');
    await page.waitForFunction(() => location.pathname === '/login', { timeout: 15000 }).catch(() => {});
    await attendre(800);
  };

  console.log('Captures :');

  // --- Sans session ---
  await aller('/login');
  await capturer('01-connexion', 760);

  // --- Administrateur ---
  await connecter(COMPTES.admin);

  await aller('/dashboard');
  await capturer('02-tableau-de-bord', 1000);

  await aller('/applications');
  await capturer('03-applications', 900);

  // L'identifiant d'application est lu dans la page : le figer dans le script le rendrait
  // dépendant d'un jeu de données précis.
  const lien = await page.locator('a[href*="/applications/"][href$="/live"]').first().getAttribute('href');
  const idApplication = lien?.split('/')[2];
  if (!idApplication) throw new Error('Aucune application déclarée : impossible de capturer ses écrans.');

  await aller(`/applications/${idApplication}/live`);
  await capturer('04-logs-temps-reel', 1000);

  await aller(`/applications/${idApplication}/history`);
  await capturer('05-historique', 950);

  await aller(`/applications/${idApplication}/services`);
  await capturer('06-services-surveilles', 900);

  await aller(`/applications/${idApplication}/rules`);
  await capturer('07-regles-alerte', 1000);

  await aller(`/applications/${idApplication}/config`);
  await capturer('08-configuration-application', 1100);

  await aller('/alerts');
  await capturer('09-alertes', 950);

  await aller('/config/global');
  await capturer('10-configuration-globale', 1100);

  await aller('/config/generalize');
  await capturer('11-generaliser', 900);

  // --- Utilisateurs : on ajoute le lecteur de démonstration, puis on capture ---
  await aller('/users');
  await page.fill('#recherche-annuaire', LECTEUR_DEMO.fragment);
  await attendre(2200);
  const boutonAjout = page.locator('button', { hasText: 'Ajouter comme' }).first();
  if ((await boutonAjout.count()) > 0) {
    await boutonAjout.click();
    await attendre(1800);
  }
  await capturer('12-utilisateurs', 1000);

  // --- Lecteur : la même liste, sans les chemins de fichiers ---
  await deconnecter();
  await connecter(COMPTES.lecteur);
  await aller('/applications');
  await capturer('13-applications-vue-lecteur', 900);

  // --- Double authentification -------------------------------------------
  //
  // L'appairage est réellement effectué le temps des captures, puis défait :
  // photographier un écran vide n'apprendrait rien, et laisser un compte de
  // démonstration appairé obligerait la personne suivante à le réinitialiser.
  await deconnecter();
  await connecter(COMPTES.superviseur);
  await aller('/compte');
  await capturer('14-mon-compte', 760);

  const boutonActiver = page.locator('button', { hasText: 'Activer la double authentification' }).first();
  if ((await boutonActiver.count()) > 0 && genererCode) {
    await boutonActiver.click();
    await attendre(1800);
    await page.click('summary').catch(() => {});
    await attendre(400);
    await capturer('15-appairage-2fa', 1000);

    const secret = (await page.locator('code').first().innerText().catch(() => '')).trim();
    if (/^[A-Z2-7]{32}$/.test(secret)) {
      await page.fill('input[inputmode=numeric]', genererCode(secret));
      await page.click('button:has-text("Activer")');
      await attendre(2000);
      await capturer('16-codes-de-recuperation', 900);

      // Seconde étape de connexion.
      await deconnecter();
      await aller('/login');
      await page.fill('#username', COMPTES.superviseur.username);
      await page.fill('#password', COMPTES.superviseur.password);
      await page.click('button[type=submit]');
      await attendre(1800);
      await capturer('17-connexion-second-facteur', 700);

      await page.fill('#code', genererCode(secret));
      await page.click('button[type=submit]');
      await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => {});
      await attendre(1200);

      // On repart d'un compte sans double authentification.
      await aller('/compte');
      page.once('dialog', (d) => d.accept());
      await page.click('button:has-text("Désactiver")').catch(() => {});
      await attendre(1500);
    }
  } else if (!genererCode) {
    console.log('  (2FA ignorée : compiler le backend d’abord — npm run build)');
  }

  await navigateur.close();
  console.log(`\nCaptures écrites dans ${SORTIE}`);
  console.log(`Pense-bête : le compte de démonstration « ${LECTEUR_DEMO.identifiant} » reste déclaré.`);
}

await main();
