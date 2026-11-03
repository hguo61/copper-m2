"use client";

// Module 2: one tool call, drawn as a round trip. The top half is what the
// model asked for (it wrote the input); the bottom half is what the app's own
// code handed back. The model never does the arithmetic itself.
import { Spinner } from "@/components/ui/spinner";
import { formatUsd } from "@/lib/copper/catalog";
import { TOOL_LABELS, type ToolStep } from "@/lib/copper/assistant/progress";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** "copper-home" → "Copper Home". */
function labelOf(id: unknown): string {
  return String(id)
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** "2026-11-14" → "Nov 14, 2026", without the time zone shifting the day. */
function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function SectionLabel({
  arrow,
  children,
}: {
  arrow: string;
  children: ReactNode;
}) {
  return (
    <p className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-widest uppercase">
      <span aria-hidden>{arrow}</span>
      <span>{children}</span>
    </p>
  );
}

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="text-muted-foreground w-16 shrink-0">{name}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function PriceRow({
  item,
  usd,
  className,
}: {
  item: ReactNode;
  usd: number;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", className)}>
      <span className="min-w-0">{item}</span>
      <span className="shrink-0 font-medium tabular-nums">
        {formatUsd(usd)}
      </span>
    </div>
  );
}

/** What Copper sent: the input as a labelled list, never raw JSON. */
function ToolInput({ name, input }: { name: string; input: unknown }) {
  if (name === "get_products")
    return (
      <p className="text-muted-foreground">
        Nothing, it just asked what Copper sells
      </p>
    );
  if (name === "get_prices")
    return (
      <p className="text-muted-foreground">
        Nothing, it just asked for the price list
      </p>
    );
  if (!isRecord(input)) return null;

  if (name === "calculate_cost") {
    const products = Array.isArray(input.products) ? input.products : [];
    return (
      <dl className="space-y-1">
        <Field name="Products">
          {products.length === 0 ? "None" : products.map(labelOf).join(", ")}
        </Field>
        <Field name="Plan">{labelOf(input.plan)}</Field>
        <Field name="Billing">{String(input.billing)}</Field>
        <Field name="Years">{String(input.years)}</Field>
      </dl>
    );
  }
  if (name === "check_availability") {
    return (
      <dl className="space-y-1">
        <Field name="Product">{labelOf(input.product)}</Field>
        <Field name="Color">
          {typeof input.color === "string" && input.color
            ? input.color
            : "Every color"}
        </Field>
      </dl>
    );
  }
  return (
    <dl className="space-y-1">
      {Object.entries(input).map(([key, value]) => (
        <Field key={key} name={labelOf(key)}>
          {typeof value === "string" ? value : JSON.stringify(value)}
        </Field>
      ))}
    </dl>
  );
}

function StockPill({
  stock,
  restockDate,
}: {
  stock: unknown;
  restockDate: unknown;
}) {
  const base =
    "rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap";
  if (stock === "in_stock")
    return (
      <span className={cn(base, "bg-accent text-accent-foreground")}>
        In stock
      </span>
    );
  if (stock === "low_stock")
    return (
      <span className={cn(base, "bg-chart-4 text-primary-foreground")}>
        Low stock
      </span>
    );
  if (stock === "backordered")
    return (
      <span className={cn(base, "bg-chart-3 text-white")}>
        Back-ordered
        {typeof restockDate === "string"
          ? ` until ${formatDate(restockDate)}`
          : ""}
      </span>
    );
  return (
    <span className={cn(base, "bg-muted text-muted-foreground")}>
      {String(stock)}
    </span>
  );
}

/** What came back: the result, laid out per tool. */
function ToolOutput({ name, output }: { name: string; output: unknown }) {
  if (
    name === "calculate_cost" &&
    isRecord(output) &&
    Array.isArray(output.lines)
  ) {
    return (
      <div className="space-y-1">
        {output.lines.map((line, i) =>
          isRecord(line) && typeof line.usd === "number" ? (
            <PriceRow key={i} item={String(line.item)} usd={line.usd} />
          ) : null,
        )}
        <div className="border-accent/30 mt-2 flex items-baseline justify-between border-t pt-2">
          <span className="font-semibold">Total</span>
          <span className="text-primary font-heading text-xl font-extrabold tabular-nums">
            {formatUsd(
              typeof output.totalUsd === "number" ? output.totalUsd : 0,
            )}
          </span>
        </div>
      </div>
    );
  }

  if (
    name === "get_products" &&
    isRecord(output) &&
    Array.isArray(output.products)
  ) {
    return (
      <div className="space-y-3">
        {output.products.map((product, i) =>
          isRecord(product) ? (
            <div key={i}>
              <PriceRow
                item={
                  <span className="font-medium">{String(product.name)}</span>
                }
                usd={
                  typeof product.priceUsd === "number" ? product.priceUsd : 0
                }
              />
              <p className="text-muted-foreground text-xs">
                {String(product.type)}
              </p>
              {Array.isArray(product.colors) && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {product.colors.map((color) => (
                    <span
                      key={String(color)}
                      className="bg-accent/15 text-accent rounded-full px-2 py-0.5 text-xs font-medium"
                    >
                      {String(color)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : null,
        )}
      </div>
    );
  }

  if (
    name === "get_prices" &&
    isRecord(output) &&
    Array.isArray(output.products)
  ) {
    const plans = Array.isArray(output.plans) ? output.plans : [];
    return (
      <div className="space-y-1">
        {output.products.map((product, i) =>
          isRecord(product) ? (
            <PriceRow
              key={i}
              item={String(product.name)}
              usd={typeof product.priceUsd === "number" ? product.priceUsd : 0}
            />
          ) : null,
        )}
        {plans.map((plan, i) => {
          if (!isRecord(plan)) return null;
          const monthly =
            typeof plan.monthlyUsd === "number" ? plan.monthlyUsd : 0;
          const annual =
            typeof plan.annualUsd === "number" ? plan.annualUsd : 0;
          if (monthly === 0 && annual === 0) return null;
          return (
            <div
              key={`plan-${i}`}
              className="flex items-baseline justify-between gap-3"
            >
              <span>{String(plan.name)}</span>
              <span className="shrink-0 font-medium tabular-nums">
                {formatUsd(monthly)}/mo · {formatUsd(annual)}/yr
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  if (name === "check_availability" && isRecord(output)) {
    if (output.status === "ok" && Array.isArray(output.colors)) {
      return (
        <div className="space-y-1.5">
          {output.colors.length === 0 && (
            <p className="text-muted-foreground">
              No stock rows for {String(output.product)}.
            </p>
          )}
          {output.colors.map((row, i) =>
            isRecord(row) ? (
              <div key={i} className="flex items-center justify-between gap-3">
                <span>{String(row.color)}</span>
                <StockPill stock={row.stock} restockDate={row.restockDate} />
              </div>
            ) : null,
          )}
        </div>
      );
    }
    if (output.status === "not_a_color") {
      const colors = Array.isArray(output.colors)
        ? output.colors.map(String)
        : [];
      return (
        <p>
          {String(output.product)} doesn&apos;t come in {String(output.color)}.
          It comes in {colors.join(", ")}.
        </p>
      );
    }
    if (output.status === "unavailable") {
      return <p className="text-chart-3">{String(output.message)}</p>;
    }
  }

  return (
    <pre className="font-mono text-xs whitespace-pre-wrap">
      {typeof output === "string" ? output : JSON.stringify(output, null, 2)}
    </pre>
  );
}

/** One tool call, always open: what Copper sent above, what came back below. */
export function ToolCallCard({
  step,
  index,
}: {
  step: ToolStep;
  index: number;
}) {
  const running = step.state === "calling";
  return (
    <div
      data-testid="tool-call"
      data-tool={step.name}
      className="border-accent/40 bg-background overflow-hidden rounded-xl border text-sm shadow-sm"
    >
      <div className="bg-accent text-accent-foreground flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="font-mono font-bold">{step.name}()</span>
        <span className="bg-accent-foreground/15 rounded-full px-2 py-0.5 text-[11px] font-medium">
          tool {index}
        </span>
        <span className="ml-auto text-xs">
          {TOOL_LABELS[step.name] ?? step.name}
        </span>
      </div>

      <div className="px-3 py-2.5">
        <SectionLabel arrow="→">What Copper sent</SectionLabel>
        {step.input === undefined ? (
          running && (
            <p className="text-muted-foreground italic">
              filling in the details…
            </p>
          )
        ) : (
          <ToolInput name={step.name} input={step.input} />
        )}
      </div>

      <div className="border-accent/30 bg-accent/10 border-t px-3 py-2.5">
        <SectionLabel arrow="←">What came back</SectionLabel>
        {step.state === "calling" ? (
          <p className="text-muted-foreground flex items-center gap-2 italic">
            <Spinner className="size-3.5" /> the app is running the code…
          </p>
        ) : step.state === "error" ? (
          <p className="text-chart-3">{String(step.output)}</p>
        ) : (
          <ToolOutput name={step.name} output={step.output} />
        )}
      </div>
    </div>
  );
}
