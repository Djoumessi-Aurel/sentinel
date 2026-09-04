'use client';

import { useCallback, useMemo, useState } from 'react';
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import type { DisplayColors, StoredLogEntry } from '@sentinel/shared-types';

/**
 * Viewer de logs virtualisé (docs/FRONTEND.md §2).
 *
 * La virtualisation n'est pas une optimisation prématurée : sans elle, un flux
 * temps réel finit par insérer des milliers de nœuds dans le DOM et le
 * navigateur devient inutilisable — précisément pendant l'incident qu'on
 * regarde. Seules les lignes visibles sont rendues.
 */

const ROW_HEIGHT = 26;

interface LogViewerProps {
  entries: StoredLogEntry[];
  colors: DisplayColors;
  height?: number;
  emptyMessage?: string;
}

function levelColor(colors: DisplayColors, level: string): string {
  // Simple lecture de la configuration déjà copiée, aucun calcul dynamique
  // (docs/CLAUDE.md §8). Un niveau inconnu retombe sur la couleur de texte.
  return colors.levelColors[level] ?? colors.text;
}

function formatTime(iso: string): string {
  // Conversion vers le fuseau du navigateur : le stockage est en UTC
  // (docs/ARCHITECTURE.md §9), l'affichage est local.
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '--:--:--'
    : date.toLocaleTimeString('fr-FR', { hour12: false }) + '.' + String(date.getMilliseconds()).padStart(3, '0');
}

export function LogViewer({ entries, colors, height = 560, emptyMessage }: LogViewerProps) {
  // État React plutôt qu'une ref mutée : react-window ne rerend une ligne que
  // si ses props changent, une mutation silencieuse resterait invisible.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const Row = useMemo(
    () =>
      function LogRow({ index, style }: ListChildComponentProps) {
        const entry = entries[index];
        if (!entry) return null;

        const isMultiline = entry.message.includes('\n');
        const isExpanded = expanded.has(entry.id);
        const [firstLine, ...rest] = entry.message.split('\n');

        return (
          <div
            style={style}
            className="flex gap-3 border-b border-slate-100 px-3 font-mono text-xs leading-[26px] hover:bg-slate-100"
          >
            <span className="shrink-0 select-none tabular-nums text-slate-500">{formatTime(entry.timestamp)}</span>
            <span
              className="w-14 shrink-0 select-none font-semibold uppercase"
              style={{ color: levelColor(colors, entry.level) }}
            >
              {entry.level}
            </span>
            <span className="min-w-0 flex-1" style={{ color: colors.text }}>
              {/* Rendu comme texte, jamais comme HTML : une ligne de log vient
                  d'un système tiers et peut être forgée (docs/SECURITY.md A03). */}
              <span className="block truncate">{firstLine}</span>
              {isMultiline && isExpanded && (
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-2 text-[11px] text-slate-600">
                  {rest.join('\n')}
                </pre>
              )}
            </span>
            {isMultiline && (
              <button
                type="button"
                onClick={() => toggle(entry.id)}
                className="shrink-0 self-start text-[11px] text-sky-700 hover:text-sky-900"
              >
                {isExpanded ? 'réduire' : `+${rest.length} ligne(s)`}
              </button>
            )}
          </div>
        );
      },
    [entries, colors, expanded, toggle],
  );

  if (entries.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-slate-200 text-sm text-slate-500"
        style={{ height, backgroundColor: colors.background }}
      >
        {emptyMessage ?? 'Aucun log pour le moment.'}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200" style={{ backgroundColor: colors.background }}>
      <FixedSizeList
        height={height}
        width="100%"
        itemCount={entries.length}
        itemSize={ROW_HEIGHT}
        itemKey={(index) => entries[index]?.id ?? index}
        overscanCount={12}
      >
        {Row}
      </FixedSizeList>
    </div>
  );
}
