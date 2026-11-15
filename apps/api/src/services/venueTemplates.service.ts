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
<<<<<<< HEAD
=======
  generateSeats: (venueId: string) => Array<{
    venueId: string;
    section: string;
    row: string;
    number: number;
    x: number;
    y: number;
    tier: string;
  }>;
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
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
<<<<<<< HEAD
=======
    generateSeats: (venueId: string) => {
      const seats: Array<{
        venueId: string;
        section: string;
        row: string;
        number: number;
        x: number;
        y: number;
        tier: string;
      }> = [];

      // VIP Recliners (Rows A, B): 8 seats per row (4 left, 4 right with wide center aisle)
      ['A', 'B'].forEach((row, rIdx) => {
        const y = 140 + rIdx * 60;
        // Left block: seats 1-4
        for (let num = 1; num <= 4; num++) {
          seats.push({
            venueId,
            section: 'VIP',
            row,
            number: num,
            x: 230 + (num - 1) * 60,
            y,
            tier: 'VIP',
          });
        }
        // Right block: seats 5-8
        for (let num = 5; num <= 8; num++) {
          seats.push({
            venueId,
            section: 'VIP',
            row,
            number: num,
            x: 590 + (num - 5) * 60,
            y,
            tier: 'VIP',
          });
        }
      });

      // Premium Club (Rows C, D, E): 12 seats per row (6 left, 6 right)
      ['C', 'D', 'E'].forEach((row, rIdx) => {
        const y = 285 + rIdx * 52;
        for (let num = 1; num <= 6; num++) {
          seats.push({
            venueId,
            section: 'PREMIUM',
            row,
            number: num,
            x: 165 + (num - 1) * 50,
            y,
            tier: 'PREMIUM',
          });
        }
        for (let num = 7; num <= 12; num++) {
          seats.push({
            venueId,
            section: 'PREMIUM',
            row,
            number: num,
            x: 565 + (num - 7) * 50,
            y,
            tier: 'PREMIUM',
          });
        }
      });

      // Standard Rows (Rows F, G, H, I): 14 seats per row (7 left, 7 right)
      ['F', 'G', 'H', 'I'].forEach((row, rIdx) => {
        const y = 465 + rIdx * 50;
        for (let num = 1; num <= 7; num++) {
          seats.push({
            venueId,
            section: 'STANDARD',
            row,
            number: num,
            x: 135 + (num - 1) * 48,
            y,
            tier: 'STANDARD',
          });
        }
        for (let num = 8; num <= 14; num++) {
          seats.push({
            venueId,
            section: 'STANDARD',
            row,
            number: num,
            x: 555 + (num - 8) * 48,
            y,
            tier: 'STANDARD',
          });
        }
      });

      return seats;
    },
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
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
<<<<<<< HEAD
=======
    generateSeats: (venueId: string) => {
      const seats: Array<{
        venueId: string;
        section: string;
        row: string;
        number: number;
        x: number;
        y: number;
        tier: string;
      }> = [];

      // VIP Front Delegation (Rows A, B): 10 seats (3 left, 4 center, 3 right)
      ['A', 'B'].forEach((row, rIdx) => {
        const y = 140 + rIdx * 56;
        // Left column
        [190, 245, 300].forEach((x, idx) => {
          seats.push({ venueId, section: 'VIP', row, number: idx + 1, x, y, tier: 'VIP' });
        });
        // Center column
        [415, 470, 525, 580].forEach((x, idx) => {
          seats.push({ venueId, section: 'VIP', row, number: idx + 4, x, y, tier: 'VIP' });
        });
        // Right column
        [695, 750, 805].forEach((x, idx) => {
          seats.push({ venueId, section: 'VIP', row, number: idx + 8, x, y, tier: 'VIP' });
        });
      });

      // Premium Corporate Desks (Rows C, D, E): 12 seats (3 left, 6 center, 3 right)
      ['C', 'D', 'E'].forEach((row, rIdx) => {
        const y = 280 + rIdx * 50;
        // Left
        [180, 235, 290].forEach((x, idx) => {
          seats.push({ venueId, section: 'PREMIUM', row, number: idx + 1, x, y, tier: 'PREMIUM' });
        });
        // Center
        [375, 425, 475, 525, 575, 625].forEach((x, idx) => {
          seats.push({ venueId, section: 'PREMIUM', row, number: idx + 4, x, y, tier: 'PREMIUM' });
        });
        // Right
        [710, 765, 820].forEach((x, idx) => {
          seats.push({ venueId, section: 'PREMIUM', row, number: idx + 10, x, y, tier: 'PREMIUM' });
        });
      });

      // Standard Conference Rows (Rows F, G, H, I): 14 seats (4 left, 6 center, 4 right)
      ['F', 'G', 'H', 'I'].forEach((row, rIdx) => {
        const y = 460 + rIdx * 48;
        // Left
        [140, 190, 240, 290].forEach((x, idx) => {
          seats.push({ venueId, section: 'STANDARD', row, number: idx + 1, x, y, tier: 'STANDARD' });
        });
        // Center
        [375, 425, 475, 525, 575, 625].forEach((x, idx) => {
          seats.push({ venueId, section: 'STANDARD', row, number: idx + 5, x, y, tier: 'STANDARD' });
        });
        // Right
        [710, 760, 810, 860].forEach((x, idx) => {
          seats.push({ venueId, section: 'STANDARD', row, number: idx + 11, x, y, tier: 'STANDARD' });
        });
      });

      return seats;
    },
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
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
<<<<<<< HEAD
=======
    generateSeats: (venueId: string) => {
      const seats: Array<{
        venueId: string;
        section: string;
        row: string;
        number: number;
        x: number;
        y: number;
        tier: string;
      }> = [];

      // Curved Amphitheater layout generator
      function generateCurvedRow(
        section: string,
        row: string,
        count: number,
        baseY: number,
        spacing: number,
        sag: number
      ) {
        for (let num = 1; num <= count; num++) {
          const offset = num - (count + 1) / 2;
          const x = 500 + offset * spacing;
          const normalized = Math.abs(offset) / (count / 2);
          const dy = Math.pow(normalized, 1.8) * sag;
          seats.push({
            venueId,
            section,
            row,
            number: num,
            x: Math.round(x),
            y: Math.round(baseY + dy),
            tier: section,
          });
        }
      }

      // VIP Stalls: Rows A, B (10 seats each)
      ['A', 'B'].forEach((row, rIdx) => {
        generateCurvedRow('VIP', row, 10, 145 + rIdx * 52, 52, 14);
      });

      // Premium Mezzanine: Rows C, D, E (12 seats each)
      ['C', 'D', 'E'].forEach((row, rIdx) => {
        generateCurvedRow('PREMIUM', row, 12, 280 + rIdx * 50, 48, 18);
      });

      // Standard Balcony: Rows F, G, H, I (14 seats each)
      ['F', 'G', 'H', 'I'].forEach((row, rIdx) => {
        generateCurvedRow('STANDARD', row, 14, 460 + rIdx * 48, 46, 24);
      });

      return seats;
    },
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
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
<<<<<<< HEAD
=======
    generateSeats: (venueId: string) => {
      const seats: Array<{
        venueId: string;
        section: string;
        row: string;
        number: number;
        x: number;
        y: number;
        tier: string;
      }> = [];

      // VIP Golden Circle Pit (Rows A, B): 10 seats flanking the central catwalk (5 left, 5 right)
      ['A', 'B'].forEach((row, rIdx) => {
        const y = 140 + rIdx * 54;
        // Left of catwalk
        for (let num = 1; num <= 5; num++) {
          seats.push({
            venueId,
            section: 'VIP',
            row,
            number: num,
            x: 200 + (num - 1) * 48,
            y,
            tier: 'VIP',
          });
        }
        // Right of catwalk
        for (let num = 6; num <= 10; num++) {
          seats.push({
            venueId,
            section: 'VIP',
            row,
            number: num,
            x: 608 + (num - 6) * 48,
            y,
            tier: 'VIP',
          });
        }
      });

      // Premium Lower Bowl (Rows C, D, E): 12 seats (6 left, 6 right)
      ['C', 'D', 'E'].forEach((row, rIdx) => {
        const y = 285 + rIdx * 50;
        for (let num = 1; num <= 6; num++) {
          seats.push({
            venueId,
            section: 'PREMIUM',
            row,
            number: num,
            x: 175 + (num - 1) * 48,
            y,
            tier: 'PREMIUM',
          });
        }
        for (let num = 7; num <= 12; num++) {
          seats.push({
            venueId,
            section: 'PREMIUM',
            row,
            number: num,
            x: 585 + (num - 7) * 48,
            y,
            tier: 'PREMIUM',
          });
        }
      });

      // Standard Upper Bowl (Rows F, G, H, I): 14 seats continuous stadium arc
      ['F', 'G', 'H', 'I'].forEach((row, rIdx) => {
        const y = 465 + rIdx * 48;
        for (let num = 1; num <= 14; num++) {
          seats.push({
            venueId,
            section: 'STANDARD',
            row,
            number: num,
            x: 145 + (num - 1) * 51,
            y,
            tier: 'STANDARD',
          });
        }
      });

      return seats;
    },
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
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
<<<<<<< HEAD
=======
    generateSeats: (venueId: string) => {
      const seats: Array<{
        venueId: string;
        section: string;
        row: string;
        number: number;
        x: number;
        y: number;
        tier: string;
      }> = [];

      ['A', 'B'].forEach((row, rIdx) => {
        const y = 135 + rIdx * 50;
        for (let num = 1; num <= 10; num++) {
          seats.push({ venueId, section: 'VIP', row, number: num, x: 275 + (num - 1) * 50, y, tier: 'VIP' });
        }
      });

      ['C', 'D', 'E'].forEach((row, rIdx) => {
        const y = 265 + rIdx * 50;
        for (let num = 1; num <= 12; num++) {
          seats.push({ venueId, section: 'PREMIUM', row, number: num, x: 225 + (num - 1) * 50, y, tier: 'PREMIUM' });
        }
      });

      ['F', 'G', 'H', 'I'].forEach((row, rIdx) => {
        const y = 445 + rIdx * 50;
        for (let num = 1; num <= 14; num++) {
          seats.push({ venueId, section: 'STANDARD', row, number: num, x: 175 + (num - 1) * 50, y, tier: 'STANDARD' });
        }
      });

      return seats;
    },
>>>>>>> 29c6a8c475027e98c9e22fa571b04319ac6898f7
  },
};

export function getVenueTemplate(type: VenueType = 'THEATER_DOLBY'): VenueTemplateConfig {
  return VENUE_TEMPLATES[type] || VENUE_TEMPLATES.THEATER_DOLBY;
}
