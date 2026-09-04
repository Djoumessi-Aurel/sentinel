import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isChannelNotified } from '../dist/index.js';
import type { AlertEvent } from '../dist/index.js';

/**
 * `isChannelNotified` décide si la sirène doit sonner pour une alerte donnée.
 *
 * Le point important : la décision n'est **pas** recalculée côté client à partir
 * de la configuration. Elle est lue dans ce que le backend a effectivement
 * consigné au moment de l'alerte, ce qui garantit que le son suit exactement les
 * canaux activés et les heures creuses, sans risque de divergence entre les deux
 * côtés (docs/ALERTING.md §2 et §4).
 */
const alerte = (channels: AlertEvent['channelsNotified']): Pick<AlertEvent, 'channelsNotified'> => ({
  channelsNotified: channels,
});

const at = '2026-09-04T12:00:00.000Z';

describe('isChannelNotified', () => {
  it('reconnaît un canal effectivement notifié', () => {
    assert.equal(isChannelNotified(alerte([{ channel: 'sound', status: 'sent', at }]), 'sound'), true);
  });

  it('exclut un canal désactivé pour l’application', () => {
    const ignore = alerte([{ channel: 'sound', status: 'skipped', detail: 'Canal désactivé', at }]);
    assert.equal(isChannelNotified(ignore, 'sound'), false);
  });

  /**
   * Cas décisif : pendant les heures creuses, le backend marque le canal sonore
   * « skipped ». La sirène doit donc rester muette, sans que le frontend ait à
   * connaître la plage horaire configurée.
   */
  it('exclut un canal mis en sourdine par les heures creuses', () => {
    const nuit = alerte([
      { channel: 'visual', status: 'sent', at },
      { channel: 'sound', status: 'skipped', detail: 'Heures creuses : canal mis en sourdine', at },
    ]);
    assert.equal(isChannelNotified(nuit, 'sound'), false);
    assert.equal(isChannelNotified(nuit, 'visual'), true);
  });

  it('exclut un canal en échec', () => {
    const echec = alerte([{ channel: 'sms', status: 'failed', detail: 'passerelle injoignable', at }]);
    assert.equal(isChannelNotified(echec, 'sms'), false);
  });

  it('exclut un canal absent de la liste', () => {
    assert.equal(isChannelNotified(alerte([{ channel: 'visual', status: 'sent', at }]), 'sound'), false);
  });

  it('gère une alerte sans aucun canal consigné', () => {
    assert.equal(isChannelNotified(alerte([]), 'sound'), false);
  });

  it('distingue bien les canaux entre eux', () => {
    const melange = alerte([
      { channel: 'visual', status: 'sent', at },
      { channel: 'sound', status: 'skipped', at },
      { channel: 'email', status: 'sent', at },
      { channel: 'sms', status: 'failed', at },
    ]);
    assert.equal(isChannelNotified(melange, 'visual'), true);
    assert.equal(isChannelNotified(melange, 'sound'), false);
    assert.equal(isChannelNotified(melange, 'email'), true);
    assert.equal(isChannelNotified(melange, 'sms'), false);
  });
});
