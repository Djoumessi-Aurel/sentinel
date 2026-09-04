/**
 * Jeu de données de démarrage.
 *
 * Reprend le parc réel décrit dans « Architecture serveurs et applications
 * monétiques.docx » : les serveurs applicatifs, les applications qui y tournent
 * et, pour chacune, les services locaux dont elle dépend. L'intérêt est double —
 * l'écran d'accueil est immédiatement parlant pour un opérateur du GIE, et les
 * cas particuliers du parc (services non systemd, processus PM2 sous deux
 * utilisateurs, frontal sur un serveur proxy distinct) sont couverts dès le
 * premier lancement.
 *
 * Idempotent : relançable sans créer de doublons.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { createHmac, randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

interface ServiceSeed {
  name: string;
  checkType?: string;
  critical?: boolean;
}

interface ApplicationSeed {
  name: string;
  type: string;
  logPath: string;
  services: ServiceSeed[];
}

interface ServerSeed {
  name: string;
  host: string;
  applications: ApplicationSeed[];
}

const PARC: ServerSeed[] = [
  {
    name: 'filemanager',
    host: '10.11.20.207',
    applications: [
      {
        name: 'filemanager',
        type: 'spring-boot',
        logPath: '/fmanager/logs/manager.log',
        services: [
          { name: 'file-manager.service' },
          { name: 'httpd.service' },
          { name: 'mysqld.service' },
          // Les échanges avec les partenaires (ICS, S2M, CBT, CBC) passent par
          // SSH/SFTP : sans sshd, les dépôts de fichiers sont bloqués.
          { name: 'sshd.service' },
        ],
      },
      {
        name: 'planning backoffice',
        type: 'java-simple',
        logPath: '/u02/ITF/mxp/planning-backoffice/log/planning-backoffice.log',
        // Pas de service applicatif : un jar lancé chaque lundi par le crontab
        // de mxp. C'est crond dont tout dépend, et son arrêt ne produit aucune
        // erreur — panne silencieuse typique.
        services: [{ name: 'crond.service' }],
      },
    ],
  },
  {
    name: 'distribcard',
    host: '10.11.20.209',
    applications: [
      {
        name: 'distribcard',
        type: 'distribcard',
        logPath: '/programs_data/programs/distribcard/logs/distribcard.log',
        services: [{ name: 'distribcard.service' }, { name: 'httpd.service' }, { name: 'mysqld.service' }],
      },
    ],
  },
  {
    name: 'visareg',
    host: '10.11.20.206',
    applications: [
      {
        name: 'visareg',
        type: 'spring-boot',
        logPath: '/programs_data/programs/visa/logs/visa.log',
        services: [{ name: 'visareg.service' }, { name: 'httpd.service' }, { name: 'mysqld.service' }],
      },
    ],
  },
  {
    name: 'LTM',
    host: '10.11.20.213',
    applications: [
      {
        name: 'LTM',
        type: 'nodejs-pm2',
        logPath: '/root/.pm2/logs/api-out-*.log',
        services: [
          // LTM WEB est un build statique servi par nginx : il n'y a pas de
          // processus frontend distinct à surveiller.
          { name: 'nginx.service' },
          { name: 'mysqld.service' },
          { name: 'api', checkType: 'pm2' },
          { name: 'watcher', checkType: 'pm2' },
          // L'updater ne tourne qu'à minuit : son arrêt n'a pas d'effet
          // immédiat, il ne doit donc pas faire basculer le badge de l'appli.
          { name: 'updater', checkType: 'pm2', critical: false },
        ],
      },
    ],
  },
  {
    name: 'Card Companion',
    host: '10.11.20.212',
    applications: [
      {
        name: 'Card Companion',
        type: 'java-simple',
        logPath: '/home/mobileapi/API_MOBILE/LOG/*.log',
        // Aucun de ces composants n'est géré par systemd : ils sont démarrés par
        // des scripts (start_auth, start_mobile_api, start_mob) sous des
        // utilisateurs applicatifs dédiés. La vérification se fait donc sur la
        // présence du processus.
        services: [
          { name: 'jboss-modules.jar', checkType: 'process' },
          { name: 'mobileapi.jar', checkType: 'process' },
          { name: 'wildfly', checkType: 'process' },
        ],
      },
    ],
  },
  {
    name: 'Serveur Proxy',
    host: '10.11.40.84',
    applications: [
      {
        name: 'Card Companion (exposition internet)',
        type: 'react-nginx',
        logPath: '/var/log/httpd/*.log',
        // Ce httpd peut tomber alors que tout le serveur applicatif fonctionne :
        // côté porteur, l'application mobile est pourtant hors service.
        services: [{ name: 'httpd.service' }],
      },
    ],
  },
  {
    name: 'Portail Marchand Backend',
    host: '10.11.20.216',
    applications: [
      {
        name: 'Portail Marchand Backend',
        type: 'java-simple',
        logPath: '/opt/tomcat/logs/catalina.out',
        services: [{ name: 'tomcat', checkType: 'process' }],
      },
    ],
  },
  {
    name: 'Portail Marchand Frontend',
    host: '10.11.40.87',
    applications: [
      {
        name: 'Portail Marchand Frontend',
        type: 'react-nginx',
        logPath: '/var/log/httpd/*.log',
        services: [{ name: 'httpd.service' }],
      },
    ],
  },
  {
    name: 'Select PX',
    host: '10.11.20.220',
    applications: [
      {
        name: 'Select PX',
        type: 'java-simple',
        logPath: '/home/spx/tools/apache-tomcat/logs/catalina.out',
        // Tomcat peut tourner avec un war non déployé : surveiller le seul
        // processus ne suffit pas, d'où les deux contrôles HTTP.
        services: [
          { name: 'apache-tomcat', checkType: 'process' },
          { name: 'gie.war', checkType: 'http' },
          { name: 'jrigie.war', checkType: 'http', critical: false },
        ],
      },
    ],
  },
];

/** Même empreinte que `AgentTokenService` : HMAC-SHA256 salé. */
function hashToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

async function main(): Promise<void> {
  const secret = process.env['AGENT_TOKEN_SECRET'];
  if (!secret || secret.length < 16) {
    throw new Error('AGENT_TOKEN_SECRET absent ou trop court : lancer le seed via `npm run db:seed`.');
  }

  const defaults = await prisma.globalConfig.findUnique({ where: { id: 'singleton' } });
  if (!defaults) {
    console.log('Config globale absente : elle sera créée au premier démarrage du backend.');
  }

  const issuedTokens: Array<{ application: string; token: string }> = [];

  for (const serverSeed of PARC) {
    const server =
      (await prisma.server.findFirst({ where: { host: serverSeed.host } })) ??
      (await prisma.server.create({ data: { name: serverSeed.name, host: serverSeed.host } }));

    for (const appSeed of serverSeed.applications) {
      const existing = await prisma.application.findFirst({
        where: { name: appSeed.name, serverId: server.id },
      });
      if (existing) {
        console.log(`  = ${appSeed.name} (déjà présente)`);
        continue;
      }

      const application = await prisma.application.create({
        data: {
          name: appSeed.name,
          type: appSeed.type,
          serverId: server.id,
          logPath: appSeed.logPath,
          createdBy: 'seed',
          updatedBy: 'seed',
        },
      });

      // La config et les règles par défaut sont normalement posées par
      // `ApplicationsService.create`. Le seed écrit directement en base : il
      // recopie donc explicitement la config globale, sans dupliquer de logique
      // métier au-delà de cette copie.
      const global = await prisma.globalConfig.findUnique({ where: { id: 'singleton' } });
      if (global) {
        const channels = global.alertChannelsDefault as {
          visual: boolean;
          sound: boolean;
          email: boolean;
          sms: boolean;
        };
        await prisma.appConfig.create({
          data: {
            applicationId: application.id,
            displayColors: global.displayColors as Prisma.InputJsonValue,
            alertChannels: {
              visual: channels.visual,
              sound: channels.sound,
              email: { enabled: channels.email, recipients: [] },
              sms: { enabled: channels.sms, recipients: [] },
            } as Prisma.InputJsonValue,
          },
        });

        const analyzers = global.analyzerDefaults as Array<{ type: string; name: string; params: unknown }>;
        await prisma.analyzerRule.createMany({
          data: analyzers.map((analyzer) => ({
            applicationId: application.id,
            type: analyzer.type,
            name: analyzer.name,
            params: analyzer.params as Prisma.InputJsonValue,
            createdBy: 'seed',
            updatedBy: 'seed',
          })),
        });
      }

      for (const serviceSeed of appSeed.services) {
        const service = await prisma.monitoredService.create({
          data: {
            applicationId: application.id,
            name: serviceSeed.name,
            checkType: serviceSeed.checkType ?? 'systemd',
            critical: serviceSeed.critical ?? true,
          },
        });

        await prisma.analyzerRule.createMany({
          data: [
            {
              applicationId: application.id,
              type: 'service-status',
              name: `Service ${service.name} arrêté`,
              params: {
                monitoredServiceId: service.id,
                expectedState: 'active',
                severity: 'critical',
              } as Prisma.InputJsonValue,
              createdBy: 'seed',
              updatedBy: 'seed',
            },
            {
              applicationId: application.id,
              type: 'service-silence',
              name: `Plus de vérification de ${service.name}`,
              params: {
                monitoredServiceId: service.id,
                maxSilence: `${service.checkInterval * 2 + 10}s`,
                severity: 'critical',
              } as Prisma.InputJsonValue,
              createdBy: 'seed',
              updatedBy: 'seed',
            },
          ],
        });
      }

      const token = randomBytes(32).toString('base64url');
      await prisma.ingestionAgentToken.create({
        data: {
          applicationId: application.id,
          serverId: server.id,
          tokenHash: hashToken(token, secret),
          label: `Agent ${appSeed.name} (seed)`,
        },
      });
      issuedTokens.push({ application: appSeed.name, token });

      console.log(`  + ${appSeed.name} sur ${serverSeed.name} (${appSeed.services.length} service(s))`);
    }
  }

  if (issuedTokens.length > 0) {
    console.log('\nTokens d’agent générés — ils ne seront plus jamais affichés :');
    for (const issued of issuedTokens) {
      console.log(`  ${issued.application.padEnd(38)} ${issued.token}`);
    }
    console.log('\nÀ reporter dans la commande d’installation sur chaque serveur :');
    console.log('  sudo ./install.sh <type> <applicationId> <backendUrl> <token> [chemin] --services a,b,c');
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
