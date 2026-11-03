// Module 2: the four tools Ask Copper can use. Products and prices come from
// lib/copper/catalog.ts and stock from lib/copper/inventory.ts, so the
// chatbot never has to make them up.
// The contract for each tool is in specs/module-2/spec.md.
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  getPlans,
  getProducts,
  type Plan,
  type ProductId,
} from "@/lib/copper/catalog";
import { readInventory } from "@/lib/copper/inventory";

export type ProductList = {
  products: {
    id: ProductId;
    name: string;
    type: string;
    priceUsd: number;
    colors: string[];
  }[];
};

export type Prices = {
  products: { id: ProductId; name: string; priceUsd: number }[];
  plans: { id: Plan["id"]; name: string; monthlyUsd: number; annualUsd: number }[];
};

export type CalculateCostInput = {
  products: ProductId[];
  plan: Plan["id"];
  billing: "monthly" | "annual";
  years: number;
};

export type CostBreakdown = {
  lines: { item: string; usd: number }[];
  totalUsd: number;
};

export type CheckAvailabilityInput = { product: ProductId; color?: string };

export type Stock = "in_stock" | "low_stock" | "backordered";

export type Availability =
  | {
      status: "ok";
      product: string;
      colors: { color: string; stock: Stock; restockDate: string | null }[];
    }
  | { status: "not_a_color"; product: string; color: string; colors: string[] }
  | { status: "unavailable"; message: string };

// The ids the tools accept. Anything else (a "copper-watch") is rejected
// before any code runs, even if the model asks for it.
const PRODUCT_IDS = ["copper-home", "copper-notes"] as const;
const PLAN_IDS = ["free", "copper-plus"] as const;

/** Rounds a dollar amount to whole cents. */
function toCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** get_products: what Copper sells and which colors each one comes in. */
export function listProducts(): ProductList {
  return {
    products: getProducts().map(({ id, name, type, priceUsd, colors }) => ({
      id,
      name,
      type,
      priceUsd,
      colors: [...colors],
    })),
  };
}

/** get_prices: every product and plan price, read from the catalog. */
export function getPrices(): Prices {
  return {
    products: getProducts().map(({ id, name, priceUsd }) => ({
      id,
      name,
      priceUsd,
    })),
    plans: getPlans().map(({ id, name, monthlyUsd, annualUsd }) => ({
      id,
      name,
      monthlyUsd,
      annualUsd,
    })),
  };
}

export const calculateCostInput: z.ZodType<CalculateCostInput> = z.object({
  products: z
    .array(z.enum(PRODUCT_IDS))
    .max(5)
    .describe(
      'The devices to buy, "copper-home" or "copper-notes". The same device can appear more than once. Up to 5.',
    ),
  plan: z.enum(PLAN_IDS).describe('The subscription: "free" or "copper-plus".'),
  billing: z
    .enum(["monthly", "annual"])
    .describe("How the plan is paid: monthly or annual."),
  years: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe("How many years to cost out, a whole number from 1 to 5."),
});

/** calculate_cost: the total cost of devices plus a plan over some years. */
export function calculateCost(input: CalculateCostInput): CostBreakdown {
  const products = getProducts();
  const plans = getPlans();
  const lines: CostBreakdown["lines"] = [];

  // Each device is paid for once.
  for (const id of input.products) {
    const product = products.find((p) => p.id === id);
    if (!product) throw new Error(`Unknown product: ${id}`);
    lines.push({ item: product.name, usd: toCents(product.priceUsd) });
  }

  // The plan covers the whole household, so it's counted once. The free
  // plan costs nothing and adds no line.
  const plan = plans.find((p) => p.id === input.plan);
  if (!plan) throw new Error(`Unknown plan: ${input.plan}`);
  const planUsd =
    input.billing === "monthly"
      ? plan.monthlyUsd * 12 * input.years
      : plan.annualUsd * input.years;
  if (planUsd > 0) {
    const yearsLabel = input.years === 1 ? "1 year" : `${input.years} years`;
    lines.push({
      item: `${plan.name}, ${input.billing}, ${yearsLabel}`,
      usd: toCents(planUsd),
    });
  }

  const totalUsd = toCents(lines.reduce((sum, line) => sum + line.usd, 0));
  return { lines, totalUsd };
}

export const checkAvailabilityInput: z.ZodType<CheckAvailabilityInput> =
  z.object({
    product: z
      .enum(PRODUCT_IDS)
      .describe('The product to check: "copper-home" or "copper-notes".'),
    color: z
      .string()
      .optional()
      .describe(
        'One color to check, like "Night Sky" (any capitalization). Leave it out to check every color.',
      ),
  });

/** check_availability: stock for one product (or one of its colors), read fresh each time. */
export async function checkAvailability(
  input: CheckAvailabilityInput,
): Promise<Availability> {
  const product = getProducts().find((p) => p.id === input.product);
  if (!product) throw new Error(`Unknown product: ${input.product}`);

  // Check the color against the catalog first, before touching stock: a color
  // the product doesn't come in is never "out of stock".
  const wanted = input.color?.trim().toLowerCase();
  const colors = wanted
    ? product.colors.filter((c) => c.toLowerCase() === wanted)
    : product.colors;
  if (wanted && colors.length === 0) {
    return {
      status: "not_a_color",
      product: product.name,
      color: input.color ?? "",
      colors: [...product.colors],
    };
  }

  // Read the stock list every time: it changes.
  const rows = await readInventory();
  if (rows === null) {
    return {
      status: "unavailable",
      message: `Stock for ${product.name} can't be checked right now. Please try again in a moment.`,
    };
  }

  const stockOf = (units: number): Stock =>
    units <= 0 ? "backordered" : units < 10 ? "low_stock" : "in_stock";

  return {
    status: "ok",
    product: product.name,
    colors: colors.flatMap((color) => {
      const row = rows.find(
        (r) =>
          r.product === product.name &&
          r.color.toLowerCase() === color.toLowerCase(),
      );
      if (!row) return [];
      const stock = stockOf(row.units_in_stock);
      return [
        {
          color,
          stock,
          restockDate: stock === "backordered" ? row.next_shipment : null,
        },
      ];
    }),
  };
}

/** The tools the model can call, each with a description so it knows when. */
export const copperTools: ToolSet = {
  get_products: tool({
    description:
      "Lists every product Copper State Labs sells, with its type, price and the colors it comes in (not stock).",
    inputSchema: z.object({}),
    execute: async () => listProducts(),
  }),
  get_prices: tool({
    description:
      "Returns the current price of every product and every subscription plan (monthly and annual).",
    inputSchema: z.object({}),
    execute: async () => getPrices(),
  }),
  calculate_cost: tool({
    description:
      "Works out the total cost of up to 5 devices plus a plan, billed monthly or annually, over 1 to 5 years.",
    inputSchema: calculateCostInput,
    execute: async (input) => calculateCost(input),
  }),
  check_availability: tool({
    description:
      "Checks today's stock for a product, for every color or one color, and says when a back-ordered color ships.",
    inputSchema: checkAvailabilityInput,
    execute: async (input) => checkAvailability(input),
  }),
};
