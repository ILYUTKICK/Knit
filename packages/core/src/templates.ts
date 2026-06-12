export type NoteTemplate = "range" | "breakout" | "ladder";

export type BinaryLeg = {
  kind: "binary";
  isUp: boolean;
  strike: bigint;
  quantity: bigint;
};

export type RangeLeg = {
  kind: "range";
  lowerStrike: bigint;
  higherStrike: bigint;
  quantity: bigint;
};

export type NoteLeg = BinaryLeg | RangeLeg;

export type NoteDefinition = {
  template: NoteTemplate;
  legs: NoteLeg[];
  maxPayout: bigint;
};

export type PayoffPoint = {
  settle: bigint;
  payout: bigint;
};

export function makeRangeNote(params: {
  lowerStrike: bigint | number | string;
  higherStrike: bigint | number | string;
  quantity: bigint | number | string;
}): NoteDefinition {
  const lowerStrike = asU64(params.lowerStrike, "lowerStrike");
  const higherStrike = asU64(params.higherStrike, "higherStrike");
  const quantity = asPositiveU64(params.quantity, "quantity");
  assertAscending([lowerStrike, higherStrike], "Range strikes must be ascending");

  return {
    template: "range",
    legs: [{ kind: "range", lowerStrike, higherStrike, quantity }],
    maxPayout: quantity,
  };
}

export function makeBreakoutNote(params: {
  lowerStrike: bigint | number | string;
  higherStrike: bigint | number | string;
  quantity: bigint | number | string;
}): NoteDefinition {
  const lowerStrike = asU64(params.lowerStrike, "lowerStrike");
  const higherStrike = asU64(params.higherStrike, "higherStrike");
  const quantity = asPositiveU64(params.quantity, "quantity");
  assertAscending([lowerStrike, higherStrike], "Breakout strikes must be ascending");

  return {
    template: "breakout",
    legs: [
      { kind: "binary", isUp: false, strike: lowerStrike, quantity },
      { kind: "binary", isUp: true, strike: higherStrike, quantity },
    ],
    maxPayout: quantity,
  };
}

export function makeLadderNote(params: {
  strikes: readonly [bigint | number | string, bigint | number | string, bigint | number | string];
  quantity: bigint | number | string;
}): NoteDefinition {
  const strikes = params.strikes.map((strike, index) => asU64(strike, `strike${index + 1}`)) as [
    bigint,
    bigint,
    bigint,
  ];
  const quantity = asPositiveU64(params.quantity, "quantity");
  assertAscending(strikes, "Ladder strikes must be ascending");

  return {
    template: "ladder",
    legs: strikes.map((strike) => ({ kind: "binary", isUp: true, strike, quantity })),
    maxPayout: quantity * 3n,
  };
}

export function payoffAt(legs: readonly NoteLeg[], settle: bigint | number | string): bigint {
  const settledPrice = asU64(settle, "settle");

  return legs.reduce((payout, leg) => {
    if (leg.kind === "range") {
      return settledPrice > leg.lowerStrike && settledPrice <= leg.higherStrike
        ? payout + leg.quantity
        : payout;
    }

    const wins = leg.isUp ? settledPrice > leg.strike : settledPrice <= leg.strike;
    return wins ? payout + leg.quantity : payout;
  }, 0n);
}

export function exactMaxPayout(legs: readonly NoteLeg[]): bigint {
  const candidates = new Set<bigint>([0n]);

  for (const leg of legs) {
    if (leg.kind === "range") {
      addBoundaryCandidates(candidates, leg.lowerStrike);
      addBoundaryCandidates(candidates, leg.higherStrike);
    } else {
      addBoundaryCandidates(candidates, leg.strike);
    }
  }

  let max = 0n;
  for (const settle of candidates) {
    const payout = payoffAt(legs, settle);
    if (payout > max) max = payout;
  }
  return max;
}

export function samplePayoff(params: {
  legs: readonly NoteLeg[];
  minSettle: bigint | number | string;
  maxSettle: bigint | number | string;
  points?: number;
}): PayoffPoint[] {
  const minSettle = asU64(params.minSettle, "minSettle");
  const maxSettle = asU64(params.maxSettle, "maxSettle");
  const points = params.points ?? 80;
  if (points < 2) throw new Error("points must be at least 2");
  assertAscending([minSettle, maxSettle], "Payoff sample range must be ascending");

  const width = maxSettle - minSettle;
  const denominator = BigInt(points - 1);

  return Array.from({ length: points }, (_, index) => {
    const settle = minSettle + (width * BigInt(index)) / denominator;
    return { settle, payout: payoffAt(params.legs, settle) };
  });
}

export function asQuoteUnits(value: number, decimals = 6): bigint {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Quote amount must be a non-negative finite number");
  }
  return BigInt(Math.round(value * 10 ** decimals));
}

export function formatQuoteUnits(value: bigint | number | string, decimals = 6): string {
  const amount = asU64(value, "value");
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function asU64(value: bigint | number | string, label: string): bigint {
  const parsed = typeof value === "bigint" ? value : BigInt(value);
  if (parsed < 0n) throw new Error(`${label} must be non-negative`);
  return parsed;
}

function asPositiveU64(value: bigint | number | string, label: string): bigint {
  const parsed = asU64(value, label);
  if (parsed === 0n) throw new Error(`${label} must be positive`);
  return parsed;
}

function assertAscending(values: readonly bigint[], message: string) {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] >= values[index]) throw new Error(message);
  }
}

function addBoundaryCandidates(candidates: Set<bigint>, value: bigint) {
  candidates.add(value);
  if (value > 0n) candidates.add(value - 1n);
  candidates.add(value + 1n);
}
