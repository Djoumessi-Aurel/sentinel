import type { ApplicationHealth } from '@sentinel/shared-types';

/**
 * Badge de statut agrégé (docs/FRONTEND.md §2).
 *
 * Il combine alertes de logs et état des services critiques — l'opérateur n'a
 * pas à savoir d'où vient le problème pour voir qu'il y en a un
 * (docs/ALERTING.md §5).
 */
const PRESENTATION: Record<ApplicationHealth, { label: string; classes: string; dot: string }> = {
  ok: { label: 'Opérationnel', classes: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30', dot: 'bg-emerald-400' },
  warning: { label: 'Avertissement', classes: 'bg-amber-500/10 text-amber-300 ring-amber-500/30', dot: 'bg-amber-400' },
  critical: { label: 'Critique', classes: 'bg-red-500/10 text-red-300 ring-red-500/30', dot: 'bg-red-400' },
  silent: { label: 'Silencieux', classes: 'bg-slate-500/10 text-slate-300 ring-slate-500/30', dot: 'bg-slate-400' },
};

export function AppStatusBadge({ health, size = 'md' }: { health: ApplicationHealth; size?: 'sm' | 'md' }) {
  const presentation = PRESENTATION[health];
  const padding = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full ring-1 ${padding} ${presentation.classes}`}>
      {/* L'animation ne signale que le critique : tout faire clignoter revient à ne rien signaler. */}
      <span className={`h-2 w-2 rounded-full ${presentation.dot} ${health === 'critical' ? 'animate-pulse' : ''}`} />
      {presentation.label}
    </span>
  );
}

/** Pastille d'état d'un service surveillé. */
export function ServiceStateDot({ state }: { state: string | null }) {
  const color =
    state === 'active'
      ? 'bg-emerald-400'
      : state === null
        ? 'bg-slate-500'
        : state === 'inactive'
          ? 'bg-amber-400'
          : 'bg-red-400';

  const label =
    state === null ? 'Jamais vérifié' : state === 'active' ? 'Actif' : state === 'inactive' ? 'Arrêté' : state === 'failed' ? 'En échec' : 'Inconnu';

  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      <span className="text-xs text-slate-400">{label}</span>
    </span>
  );
}
