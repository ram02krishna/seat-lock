/**
 * Sanity checks for the capacity-driven seat layout generator (no database needed).
 * Run with: pnpm --filter api check:layout
 */
import assert from 'node:assert/strict';
import { buildSeatPlan, planExtension, planShrink, rowLabel, rowIndexOf } from '../src/services/seatLayout.service';
import { VENUE_TEMPLATES } from '../src/services/venueTemplates.service';

const key = (s: { section: string; row: string; number: number }) => `${s.section}|${s.row}|${s.number}`;
const types = Object.keys(VENUE_TEMPLATES) as Array<keyof typeof VENUE_TEMPLATES>;

assert.equal(rowLabel(0), 'A');
assert.equal(rowLabel(25), 'Z');
assert.equal(rowLabel(26), 'AA');
for (const i of [0, 1, 25, 26, 51, 52, 700]) assert.equal(rowIndexOf(rowLabel(i)), i);

// 1. The generated seat count always equals the requested capacity, with unique seat ids
for (const type of types) {
  for (const total of [1, 2, 5, 10, 50, 74, 120, 333, 1000, 2000]) {
    const plan = buildSeatPlan({ venueType: type, totalSeats: total });
    assert.equal(plan.seats.length, total, `${type} ${total}`);
    assert.equal(new Set(plan.seats.map(key)).size, total, `unique ${type} ${total}`);
    assert.equal(plan.layout.capacity, total);
    // no two seats overlap on the map
    const pos = new Set(plan.seats.map((s) => `${s.x},${s.y}`));
    assert.equal(pos.size, total, `overlap ${type} ${total}`);
  }
}

// 2. Explicit seats per row / tier split are honoured
const custom = buildSeatPlan({ venueType: 'ARENA', totalSeats: 100, seatsPerRow: 20, vipSeats: 20, premiumSeats: 30 });
assert.equal(custom.seats.filter((s) => s.tier === 'VIP').length, 20);
assert.equal(custom.seats.filter((s) => s.tier === 'PREMIUM').length, 30);
assert.equal(custom.seats.filter((s) => s.tier === 'STANDARD').length, 50);
assert.ok(Math.max(...custom.seats.map((s) => s.number)) <= 20);

// 3. Invalid input is rejected
assert.throws(() => buildSeatPlan({ venueType: 'OTHERS', totalSeats: 0 }));
assert.throws(() => buildSeatPlan({ venueType: 'OTHERS', totalSeats: 2001 }));
assert.throws(() => buildSeatPlan({ venueType: 'OTHERS', totalSeats: 10, vipSeats: 8, premiumSeats: 8 }));

// 4. Growing never moves or renumbers existing seats and never collides
for (const [from, to] of [[50, 120], [50, 51], [7, 100], [120, 121], [1, 30]] as const) {
  const plan = buildSeatPlan({ venueType: 'THEATER_DOLBY', totalSeats: from });
  const existing = plan.seats.map((s, i) => ({ id: String(i), ...s }));
  const added = planExtension(existing, plan.layout, to - from);
  assert.equal(added.length, to - from);
  const all = [...existing, ...added];
  assert.equal(new Set(all.map(key)).size, to, `extend ${from}->${to}`);
  assert.equal(new Set(all.map((s) => `${s.x},${s.y}`)).size, to, `extend overlap ${from}->${to}`);
}

// 5. Shrinking removes from the rear and never touches protected seats
{
  const plan = buildSeatPlan({ venueType: 'OTHERS', totalSeats: 60 });
  const seats = plan.seats.map((s, i) => ({ id: String(i), ...s, protected: false }));
  const lastIdx = seats.length - 1;
  seats[lastIdx]!.protected = true; // pretend the very last seat is sold
  const ids = planShrink(seats, 10);
  assert.equal(ids.length, 10);
  assert.ok(!ids.includes(String(lastIdx)));
  // cannot shrink below the protected seats
  const many = seats.map((s, i) => ({ ...s, protected: i < 55 }));
  assert.throws(() => planShrink(many, 10), /can't go below 55/);
}

console.log('seat layout checks passed');
