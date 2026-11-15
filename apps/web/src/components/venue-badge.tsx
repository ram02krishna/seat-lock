import React from 'react';
import { Film, Presentation, Landmark, Music2, Building2 } from 'lucide-react';

export type VenueTypeKey = 'THEATER_DOLBY' | 'CONFERENCE_HALL' | 'AUDITORIUM' | 'ARENA' | 'OTHERS';

export const VENUE_LABELS: Record<VenueTypeKey, string> = {
  THEATER_DOLBY: 'Cinema',
  CONFERENCE_HALL: 'Conference',
  AUDITORIUM: 'Auditorium',
  ARENA: 'Concert arena',
  OTHERS: 'Event hall',
};

const VENUE_ICONS: Record<VenueTypeKey, React.ComponentType<{ className?: string }>> = {
  THEATER_DOLBY: Film,
  CONFERENCE_HALL: Presentation,
  AUDITORIUM: Landmark,
  ARENA: Music2,
  OTHERS: Building2,
};

export function normalizeVenueType(type?: string | null): VenueTypeKey {
  return type && type in VENUE_LABELS ? (type as VenueTypeKey) : 'OTHERS';
}

interface VenueBadgeProps {
  type?: VenueTypeKey | string | null;
  className?: string;
}

export function VenueBadge({ type, className = '' }: VenueBadgeProps) {
  if (!type) return null;
  const key = normalizeVenueType(type);
  const Icon = VENUE_ICONS[key];

  return (
    <span className={`tag ${className}`}>
      <Icon className="h-3 w-3" />
      {VENUE_LABELS[key]}
    </span>
  );
}
