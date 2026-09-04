import { RedactionService } from './redaction.service';

describe('RedactionService', () => {
  const redaction = new RedactionService();

  describe('numéros de carte', () => {
    it('masque un PAN en conservant les 4 derniers chiffres', () => {
      expect(redaction.redact('paiement carte 4111111111111111 accepté')).toBe(
        'paiement carte **** **** **** 1111 accepté',
      );
    });

    it('masque un PAN écrit avec des espaces ou des tirets', () => {
      expect(redaction.redact('4111 1111 1111 1111')).toBe('**** **** **** 1111');
      expect(redaction.redact('4111-1111-1111-1111')).toBe('**** **** **** 1111');
    });

    /**
     * Le contrôle de Luhn évite de masquer les identifiants métier : un numéro
     * de commande à 16 chiffres masqué rendrait les logs inexploitables pour le
     * support, qui cesserait alors de faire confiance à l'outil.
     */
    it('laisse intact un nombre à 16 chiffres qui ne passe pas Luhn', () => {
      expect(redaction.redact('commande 1234567890123456 traitée')).toBe('commande 1234567890123456 traitée');
    });

    it('laisse intact un nombre trop court pour être un PAN', () => {
      expect(redaction.redact('code 12345678901')).toBe('code 12345678901');
    });
  });

  describe('secrets', () => {
    it('masque un mot de passe en clair', () => {
      expect(redaction.redact('connexion password=Sup3rSecret!')).toBe('connexion password=***');
    });

    it('masque une clé d’API quelle que soit son écriture', () => {
      expect(redaction.redact('api_key: abcdef123456')).toBe('api_key=***');
      expect(redaction.redact('API-KEY=abcdef123456')).toBe('API-KEY=***');
    });

    it('masque un jeton Bearer', () => {
      expect(redaction.redact('Authorization: Bearer abcdefghijklmnop')).toBe('Authorization: Bearer ***');
    });

    it('masque un JWT', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      expect(redaction.redact(`token=${jwt}`)).toBe('token=***');
    });

    it('masque le mot de passe d’une URL de connexion sans perdre l’utilisateur', () => {
      expect(redaction.redact('mysql://sentinel:motdepasse@10.11.20.207:3306/base')).toBe(
        'mysql://sentinel:***@10.11.20.207:3306/base',
      );
    });

    it('masque un code PIN et un CVV', () => {
      expect(redaction.redact('pin=1234')).toBe('pin=***');
      expect(redaction.redact('CVV: 123')).toBe('CVV=***');
    });
  });

  describe('numéros de téléphone', () => {
    it('masque un numéro international en gardant les 3 derniers chiffres', () => {
      expect(redaction.redact('SMS envoyé à +237690123456')).toMatch(/SMS envoyé à \+\*+456/);
    });

    it('ne masque pas une adresse IP', () => {
      expect(redaction.redact('depuis 10.11.20.207')).toBe('depuis 10.11.20.207');
    });
  });

  describe('cas courants', () => {
    it('laisse une ligne ordinaire intacte', () => {
      const line = 'Traitement de fin de journée terminé en 1240 ms';
      expect(redaction.redact(line)).toBe(line);
    });

    it('masque plusieurs occurrences dans la même ligne', () => {
      const result = redaction.redact('carte 4111111111111111 et password=x1234567');
      expect(result).toContain('**** **** **** 1111');
      expect(result).toContain('password=***');
    });

    /**
     * Les regex globales portent un `lastIndex` : sans remise à zéro, le second
     * appel sauterait des correspondances. Ce test verrouille ce point, qui est
     * silencieux et donc facile à réintroduire.
     */
    it('donne le même résultat sur des appels successifs', () => {
      const line = 'carte 4111111111111111';
      expect(redaction.redact(line)).toBe(redaction.redact(line));
    });
  });

  describe('redactMetadata', () => {
    it('masque les valeurs texte et conserve nombres et booléens', () => {
      expect(redaction.redactMetadata({ pan: '4111111111111111', status: 502, retried: true })).toEqual({
        pan: '**** **** **** 1111',
        status: 502,
        retried: true,
      });
    });

    it('accepte l’absence de métadonnées', () => {
      expect(redaction.redactMetadata(undefined)).toBeUndefined();
    });
  });
});
