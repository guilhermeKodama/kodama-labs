'use client';

import { useTranslations } from 'next-intl';
import { Building2, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface EntityFilterItem {
  id: string;
  name: string;
  type: 'business' | 'personal';
  color?: string;
}

interface EntityFilterBarProps {
  entities: EntityFilterItem[];
  selectedEntityIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
}

const DEFAULT_PERSONAL_COLOR = '#8b5cf6';

export function EntityFilterBar({
  entities,
  selectedEntityIds,
  onSelectionChange,
}: EntityFilterBarProps) {
  const t = useTranslations();

  if (entities.length < 2) return null;

  const isAllSelected = selectedEntityIds.size === 0;
  const activeCount = isAllSelected ? entities.length : selectedEntityIds.size;

  const handleSelectAll = () => {
    onSelectionChange(new Set());
  };

  const handleToggleEntity = (entityId: string) => {
    const next = new Set(selectedEntityIds);

    if (isAllSelected) {
      // Switching from "all" to a single entity — select only this one
      entities.forEach((e) => {
        if (e.id !== entityId) next.add(e.id);
      });
      // Actually, toggle means we want to *deselect* this entity from "all"
      // Better UX: clicking a pill when "all" is active selects *only* that entity
      onSelectionChange(new Set([entityId]));
      return;
    }

    if (next.has(entityId)) {
      next.delete(entityId);
    } else {
      next.add(entityId);
    }

    // If all entities would be selected, reset to "all" (empty set)
    if (next.size === entities.length) {
      onSelectionChange(new Set());
      return;
    }

    // Don't allow deselecting everything
    if (next.size === 0) {
      return;
    }

    onSelectionChange(next);
  };

  const isEntitySelected = (entityId: string) => {
    return isAllSelected || selectedEntityIds.has(entityId);
  };

  const getEntityColor = (entity: EntityFilterItem) => {
    if (entity.type === 'personal') return DEFAULT_PERSONAL_COLOR;
    return entity.color || '#06b6d4';
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleSelectAll}
        className={cn(
          'rounded-full border text-xs transition-colors',
          isAllSelected
            ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 hover:text-cyan-300'
            : 'border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white'
        )}
      >
        {t('filters.allEntities')}
      </Button>

      {entities.map((entity) => {
        const selected = isEntitySelected(entity.id);
        const color = getEntityColor(entity);
        const Icon = entity.type === 'personal' ? User : Building2;

        return (
          <Button
            key={entity.id}
            variant="outline"
            size="sm"
            onClick={() => handleToggleEntity(entity.id)}
            className={cn(
              'rounded-full border text-xs transition-colors',
              selected
                ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 hover:text-cyan-300'
                : 'border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white'
            )}
          >
            <span
              className="mr-1.5 inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: color }}
            />
            <Icon className="mr-1 h-3 w-3" />
            {entity.name}
          </Button>
        );
      })}

      {!isAllSelected && (
        <Badge
          variant="outline"
          className="ml-1 border-slate-700 bg-slate-800/50 text-xs text-slate-400"
        >
          {t('filters.showingCount', { count: activeCount, total: entities.length })}
        </Badge>
      )}
    </div>
  );
}
