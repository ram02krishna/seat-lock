import { VenueType } from '@repo/shared';

export interface VenueTemplateLayout {
  width: number;
  height: number;
  type: VenueType;
  stage: {
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
    subtitle: string;
  };
  features: string[];
  sections: Array<{
    id: string;
    name: string;
    tier: string;
    color: string;
    defaultPriceCents: number;
  }>;
}

export interface VenueTemplateConfig {
  defaultName: string;
  layout: VenueTemplateLayout;
  recommendedPricing: {
    VIP: number;
    PREMIUM: number;
    STANDARD: number;
  };
}

export const VENUE_TEMPLATES: Record<VenueType, VenueTemplateConfig> = {
  THEATER_DOLBY: {
    defaultName: 'Dolby Atmos Cinema',
    layout: {
      width: 1000,
      height: 760,
      type: 'THEATER_DOLBY',
      stage: {
        x: 180,
        y: 22,
        width: 640,
        height: 44,
        label: 'CURVED DOLBY ATMOS SCREEN',
        subtitle: '4K LASER PROJECTION • 64-CHANNEL SPATIAL SURROUND',
      },
      features: [
        'Dolby Atmos 360°',
        '4K Laser Screen',
        'VIP Recliner Stalls',
        'Dual Cinema Aisles',
      ],
      sections: [
        { id: 'VIP', name: 'VIP Recliner Stalls', tier: 'VIP', color: '#8b5cf6', defaultPriceCents: 120000 },
        { id: 'PREMIUM', name: 'Premium Club Cinema', tier: 'PREMIUM', color: '#3b82f6', defaultPriceCents: 70000 },
        { id: 'STANDARD', name: 'Executive Cinema Stalls', tier: 'STANDARD', color: '#10b981', defaultPriceCents: 40000 },
      ],
    },
    recommendedPricing: {
      VIP: 120000,
      PREMIUM: 70000,
      STANDARD: 40000,
    },
  },

  CONFERENCE_HALL: {
    defaultName: 'Convention Centre Hall',
    layout: {
      width: 1000,
      height: 750,
      type: 'CONFERENCE_HALL',
      stage: {
        x: 230,
        y: 24,
        width: 540,
        height: 48,
        label: 'KEYNOTE PRESENTATION STAGE',
        subtitle: 'EXECUTIVE PODIUM • DUAL 8K PRESENTATION DISPLAYS',
      },
      features: [
        'Dual Projection Displays',
        'Speaker Podium',
        'Executive Delegation Desks',
        'Dual Conference Aisles',
      ],
      sections: [
        { id: 'VIP', name: 'Executive Front Delegation', tier: 'VIP', color: '#f59e0b', defaultPriceCents: 250000 },
        { id: 'PREMIUM', name: 'Corporate Delegate Desks', tier: 'PREMIUM', color: '#06b6d4', defaultPriceCents: 150000 },
        { id: 'STANDARD', name: 'General Conference Rows', tier: 'STANDARD', color: '#10b981', defaultPriceCents: 80000 },
      ],
    },
    recommendedPricing: {
      VIP: 250000,
      PREMIUM: 150000,
      STANDARD: 80000,
    },
  },

  AUDITORIUM: {
    defaultName: 'Grand Auditorium',
    layout: {
      width: 1000,
      height: 760,
      type: 'AUDITORIUM',
      stage: {
        x: 210,
        y: 20,
        width: 580,
        height: 52,
        label: 'GRAND ORCHESTRA STAGE & PIT',
        subtitle: 'ACOUSTIC TIMBER SHELL • PROSCENIUM ARCH & BALCONIES',
      },
      features: [
        'Acoustic Shell',
        'Orchestra Pit',
        'Curved Amphitheater Tiers',
        'Royal Balcony Boxes',
      ],
      sections: [
        { id: 'VIP', name: 'Orchestra Stalls (Royal)', tier: 'VIP', color: '#ec4899', defaultPriceCents: 280000 },
        { id: 'PREMIUM', name: 'Grand Mezzanine Tier', tier: 'PREMIUM', color: '#8b5cf6', defaultPriceCents: 175000 },
        { id: 'STANDARD', name: 'Upper Balcony Gallery', tier: 'STANDARD', color: '#3b82f6', defaultPriceCents: 85000 },
      ],
    },
    recommendedPricing: {
      VIP: 280000,
      PREMIUM: 175000,
      STANDARD: 85000,
    },
  },

  ARENA: {
    defaultName: 'Concert Arena',
    layout: {
      width: 1000,
      height: 770,
      type: 'ARENA',
      stage: {
        x: 190,
        y: 18,
        width: 620,
        height: 50,
        label: 'FESTIVAL THRUST STAGE & RUNWAY',
        subtitle: 'CATWALK RUNWAY • CONCERT LIGHTING RIG • BASS ARRAYS',
      },
      features: [
        'Catwalk Runway',
        'Golden Circle Front Pit',
        'Stadium Lower & Upper Bowl',
        'FOH Sound Console',
      ],
      sections: [
        { id: 'VIP', name: 'Golden Circle Front Pit', tier: 'VIP', color: '#f43f5e', defaultPriceCents: 350000 },
        { id: 'PREMIUM', name: 'Lower Bowl Club Seats', tier: 'PREMIUM', color: '#a855f7', defaultPriceCents: 200000 },
        { id: 'STANDARD', name: 'Upper Bowl Bleachers', tier: 'STANDARD', color: '#06b6d4', defaultPriceCents: 95000 },
      ],
    },
    recommendedPricing: {
      VIP: 350000,
      PREMIUM: 200000,
      STANDARD: 95000,
    },
  },

  OTHERS: {
    defaultName: 'Multipurpose Hall',
    layout: {
      width: 1000,
      height: 700,
      type: 'OTHERS',
      stage: {
        x: 250,
        y: 28,
        width: 500,
        height: 48,
        label: 'MAIN STAGE & PRESENTATION AREA',
        subtitle: 'VERSATILE EVENT SPACE • BALANCED ACOUSTICS',
      },
      features: ['Versatile Staging', 'Adjustable Lighting', 'Multi-Tier Seating'],
      sections: [
        { id: 'VIP', name: 'VIP Front Row', tier: 'VIP', color: '#8b5cf6', defaultPriceCents: 250000 },
        { id: 'PREMIUM', name: 'Premium Middle', tier: 'PREMIUM', color: '#3b82f6', defaultPriceCents: 150000 },
        { id: 'STANDARD', name: 'Standard General', tier: 'STANDARD', color: '#10b981', defaultPriceCents: 75000 },
      ],
    },
    recommendedPricing: {
      VIP: 250000,
      PREMIUM: 150000,
      STANDARD: 75000,
    },
  },
};

export function getVenueTemplate(type: VenueType = 'THEATER_DOLBY'): VenueTemplateConfig {
  return VENUE_TEMPLATES[type] || VENUE_TEMPLATES.THEATER_DOLBY;
}
