import { Injectable } from '@nestjs/common';

/**
 * Masquage des données sensibles, appliqué **avant persistance**
 * (docs/LOG_PARSERS.md §6, docs/SECURITY.md A09).
 *
 * Point essentiel : masquer à l'affichage ne suffirait pas. Les logs du parc
 * monétique peuvent contenir des numéros de carte ; une fois stockés en clair,
 * ils le restent pour quiconque accède au stockage ou à une sauvegarde. Le
 * masquage a donc lieu dans le pipeline d'ingestion, en amont de l'écriture.
 *
 * Étape indépendante des parseurs : elle s'applique quel que soit le type
 * d'appli, y compris ceux ajoutés plus tard.
 */

interface RedactionRule {
  readonly name: string;
  readonly pattern: RegExp;
  readonly replace: (match: string, ...groups: string[]) => string;
}

/** Algorithme de Luhn — évite de masquer un numéro de commande à 16 chiffres. */
function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = digits.charCodeAt(index) - 48;
    if (value < 0 || value > 9) return false;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

const DEFAULT_RULES: readonly RedactionRule[] = [
  {
    // PAN : 13 à 19 chiffres, éventuellement séparés par des espaces ou tirets.
    // On conserve les 4 derniers chiffres, seule information utile au support.
    name: 'pan',
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    replace: (match) => {
      const digits = match.replace(/[ -]/g, '');
      if (digits.length < 13 || digits.length > 19 || !passesLuhn(digits)) return match;
      return `**** **** **** ${digits.slice(-4)}`;
    },
  },
  {
    name: 'cvv',
    pattern: /\b(cvv|cvc|cvv2|csc)\s*[:=]\s*\d{3,4}\b/gi,
    replace: (_match, label: string) => `${label}=***`,
  },
  {
    name: 'pin',
    pattern: /\b(pin|code\s*pin)\s*[:=]\s*\d{4,12}\b/gi,
    replace: (_match, label: string) => `${label}=***`,
  },
  {
    name: 'bearer',
    pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{12,}=*/g,
    replace: (_match, scheme: string) => `${scheme} ***`,
  },
  {
    name: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replace: () => '***jwt***',
  },
  {
    // Mot de passe ou secret en clair dans une ligne de log ou une URL.
    name: 'secret',
    pattern: /\b(password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi,
    replace: (_match, label: string) => `${label}=***`,
  },
  {
    // Identifiants dans une URL : mysql://user:motdepasse@hote
    name: 'url-credentials',
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/gi,
    replace: (_match, scheme: string, user: string) => `${scheme}${user}:***@`,
  },
  {
    // Numéros de téléphone au format international (destinataires SMS).
    name: 'phone',
    pattern: /(?<![\d.])\+\d{8,15}(?![\d.])/g,
    replace: (match) => `+${'*'.repeat(Math.max(match.length - 5, 1))}${match.slice(-3)}`,
  },
];

@Injectable()
export class RedactionService {
  private readonly rules: readonly RedactionRule[] = DEFAULT_RULES;

  /** Masque une chaîne. Retourne la chaîne telle quelle si rien ne correspond. */
  redact(text: string): string {
    let result = text;
    for (const rule of this.rules) {
      // `lastIndex` est remis à zéro : les regex globales sont à état, et une
      // instance partagée entre appels sauterait des correspondances.
      rule.pattern.lastIndex = 0;
      result = result.replace(rule.pattern, rule.replace as (...args: string[]) => string);
    }
    return result;
  }

  /**
   * Masque les valeurs textuelles d'un bloc de métadonnées. Les nombres et
   * booléens sont laissés tels quels : ce sont des valeurs qualifiées par les
   * parseurs (code HTTP, compteur), pas du texte libre venu de l'application.
   */
  redactMetadata<T extends Record<string, string | number | boolean> | undefined>(metadata: T): T {
    if (!metadata) return metadata;
    const output: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(metadata)) {
      output[key] = typeof value === 'string' ? this.redact(value) : value;
    }
    return output as T;
  }
}
