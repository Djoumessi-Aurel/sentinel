import { parserRegistry } from './registry';
import { genericParser } from './generic.parser';
import { javaSimpleParser, springBootParser } from './spring-boot.parser';
import { distribcardParser } from './distribcard.parser';
import { nodePm2Parser } from './nodejs-pm2.parser';
import { reactNginxParser } from './react-nginx.parser';

// Enregistrement de tous les parseurs connus. C'est le seul endroit à modifier
// pour ajouter un type d'appli (docs/LOG_PARSERS.md §5).
parserRegistry.setFallback(genericParser);
parserRegistry.register(springBootParser);
parserRegistry.register(javaSimpleParser);
parserRegistry.register(distribcardParser);
parserRegistry.register(nodePm2Parser);
parserRegistry.register(reactNginxParser);

export { parserRegistry, ParserRegistry } from './registry';
export type { LogEntry, LogLevel, LogParser, ParseContext } from './types';
export { GenericParser, genericParser, detectLevel } from './generic.parser';
export { SpringBootParser, springBootParser, javaSimpleParser } from './spring-boot.parser';
export { DistribcardParser, distribcardParser } from './distribcard.parser';
export { NodePm2Parser, nodePm2Parser } from './nodejs-pm2.parser';
export { ReactNginxParser, reactNginxParser } from './react-nginx.parser';
export { toUtcIso, clfToUtcIso, nowUtcIso } from './time';
