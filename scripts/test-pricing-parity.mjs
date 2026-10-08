/**
 * The client pricing helper must agree with the database, and this is the check.
 *
 * `src/lib/pricing.ts` exists to duplicate `public.calculate_sale_price` and the
 * badge wording so the product form can preview the stored result while the admin
 * types. That duplication is the whole design, and a duplication nobody verifies
 * is just two implementations that happen to agree today: the preview would show
 * one price, the server would store another, and the form would be confidently
 * wrong. The drift is invisible by construction -- both sides are individually
 * correct -- which is exactly the failure mode a comment cannot catch and only a
 * comparison can.
 *
 * So every function here is evaluated in JavaScript AND in SQL over a set of
 * awkward cases, and the two answers are compared. The cases are chosen to be
 * unfriendly: paisa values, halves that round either way, discounts that consume
 * the entire price, and prices with no discount at all.
 *
 * Run with the server-independent prerequisites only -- no Next server needed:
 *
 *   set -a; . ./.env.local; set +a; node scripts/test-pricing-parity.mjs
 *
 * The one thing it deliberately does NOT check is the JavaScript source: it is
 * imported as TypeScript through Node's type stripping, so the helper under test
 * is the real file rather than a copy of it.
 */

const REF = "khebwqdhucrdfpfadxry";

let fails = 0;
const check = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) fails++;
  console.log(
    `${pass ? "PASS  " : "FAIL  "}${label.padEnd(58)} got=${JSON.stringify(actual)}${pass ? "" : " want=" + JSON.stringify(expected)}`
  );
};
const section = (n, title) => console.log(`\n=== ${n}. ${title} ===`);

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("SUPABASE_ACCESS_TOKEN is not set. Source .env.local first.");
  process.exit(1);
}

/** One round trip per query, no retries: this suite has nothing to recover from. */
async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  if (r.status >= 400) {
    throw new Error(`SQL failed: ${text.slice(0, 300)}\n${query.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : null;
}

const scalar = async (query) => (await sql(query))[0];

const {
  salePrice,
  percentBetween,
  discountBadgeLabel,
  deriveDiscount,
  roundPercent,
  formatTaka,
  normalizeDiscount,
} = await import("../src/lib/pricing.ts");

// ---------------------------------------------------------------- 1
section(1, "salePrice mirrors calculate_sale_price");
// Both the clamp at zero and the ROUND(..., 2) matter. The clamp because a flat
// discount of exactly the price is legal and must give 0 rather than a negative,
// and the rounding because an unrounded preview is how a form comes to show
// 849.99 and then save 850.00.
const SALE_CASES = [
  [1000, "percentage", 15],
  [1000, "percentage", 14.8],
  [400, "percentage", 12.5],
  [700, "flat", 150],
  [500, "flat", 500], // the whole price: clamps to zero, not to -0
  [349.99, "percentage", 0], // no discount: the base, to the paisa
  [1234.56, "percentage", 7.77],
  [999, "flat", 0.01], // the smallest possible markdown
  [100, "percentage", 100], // total markdown
  [85.5, "flat", 0.5], // a half paisa that has to round
  [0, "percentage", 10], // no base price at all
  [1000, "percentage", 33.33],
  [66.66, "flat", 0.01],
  [0.03, "percentage", 50], // rounds to 0.02
];
for (const [regular, type, value] of SALE_CASES) {
  const row = await scalar(
    `SELECT public.calculate_sale_price(${regular}, '${type}', ${value})::float8 AS sale`
  );
  check(`salePrice(${regular}, ${type}, ${value})`, salePrice(regular, type, value), Number(row.sale));
}

// ---------------------------------------------------------------- 2
section(2, "percentBetween mirrors the comparison-mode arithmetic");
// The CASTs are load-bearing and were not there the first time this was written.
// In admin_save_product the operands are NUMERIC variables, but written as bare
// literals in a check like this they are integers, so (1000 - 850) / 1000 is
// integer division and returns 0. Every case below then agrees with a wrong
// answer, which is a worse failure than an outright mismatch because it looks
// like a pass.
const COMPARE_CASES = [
  [1000, 850],
  [400, 349.99], // 12.5025, stored at two decimals
  [700, 550],
  [1000, 1000], // no change
  [500, 600], // a rise, which the server treats as no discount
  [85.5, 42.75],
  [3, 1], // 66.67 to two decimals
  [100000, 1], // a very large base
];
for (const [oldPrice, newPrice] of COMPARE_CASES) {
  const row = await scalar(`
    SELECT ROUND((CAST(${oldPrice} AS NUMERIC) - CAST(${newPrice} AS NUMERIC))
                 / CAST(${oldPrice} AS NUMERIC) * 100, 2)::float8 AS pct
  `);
  check(`percentBetween(${oldPrice}, ${newPrice})`, percentBetween(oldPrice, newPrice), Number(row.pct));
}

// ---------------------------------------------------------------- 3
section(3, "discountBadgeLabel mirrors the badge written on save");
// This is the rounding requirement, checked on both sides: a percentage is shown
// as a whole number while the stored value keeps its decimals, so 14.8 and 12.5
// become "15% OFF" and "13% OFF" rather than two unreadable labels.
const BADGE_CASES = [
  [1000, "percentage", 14.8],
  [400, "percentage", 12.5],
  [1000, "percentage", 15],
  [700, "flat", 150], // trailing zeros stripped
  [700, "flat", 150.5],
  [700, "flat", 0.5],
  [1000, "percentage", 0], // no discount, so no badge at all
  [700, "flat", 0],
];
for (const [regular, type, value] of BADGE_CASES) {
  const row = await scalar(`
    SELECT CASE
             WHEN public.calculate_sale_price(${regular}, '${type}', ${value}) < ${regular}
             THEN CASE WHEN '${type}' = 'percentage'
                       THEN ROUND(${value})::INTEGER || '% OFF'
                       ELSE public.fmt_num(${value}) || ' OFF'
                   END
           END AS badge
  `);
  check(
    `discountBadgeLabel(${regular}, ${type}, ${value})`,
    discountBadgeLabel(type, value),
    row.badge ?? null
  );
}

// ---------------------------------------------------------------- 4
section(4, "the pieces agree with each other");
// deriveDiscount is the function the form actually calls, so it is checked
// against the same SQL the server uses rather than against the helpers it is
// built from -- a helper that agrees with the database and a composition of
// helpers that does not is still a wrong preview.
const flatRow = await scalar(`
  SELECT public.calculate_sale_price(700, 'flat', 150)::float8 AS sale,
         ROUND((700 - public.calculate_sale_price(700, 'flat', 150)) / 700 * 100)::int AS pct
`);
const flatDerived = deriveDiscount(700, "flat", 150);
check("a flat markdown's sale price", flatDerived.sale, Number(flatRow.sale));
check("and the percentage it represents", flatDerived.percent, flatRow.pct);
check("and its badge names the amount", flatDerived.badgeLabel, "150 OFF");

const pctRow = await scalar(`
  SELECT public.calculate_sale_price(1000, 'percentage', 14.8)::float8 AS sale
`);
const pctDerived = deriveDiscount(1000, "percentage", 14.8);
check("a percentage markdown's sale price", pctDerived.sale, Number(pctRow.sale));
check("its percentage is rounded for display", pctDerived.percent, 15);
check("and its badge agrees", pctDerived.badgeLabel, "15% OFF");

// A markdown that does not lower the price is not a discount, whatever the
// numbers say. This is the shape that used to put "SALE" on a full-price
// product.
check("no badge when the price does not fall", deriveDiscount(500, "flat", 0).badgeLabel, null);
check("and no discount reported", deriveDiscount(500, "flat", 0).hasDiscount, false);

// ---------------------------------------------------------------- 5
section(5, "normalizeDiscount collapses the modes onto one triple");
check("comparison derives the percentage between two prices",
  normalizeDiscount({ mode: "comparison", regular: 1000, discountType: "percentage", discountValue: 0, comparisonPrice: 850 }),
  { regular: 1000, type: "percentage", value: 15 });
// A rise is not a discount, and reporting it as one would be a negative markdown
// that the column CHECK refuses -- turning a form mistake into a database error.
check("a new price above the old one is no discount",
  normalizeDiscount({ mode: "comparison", regular: 500, discountType: "percentage", discountValue: 0, comparisonPrice: 600 }),
  { regular: 500, type: "percentage", value: 0 });
check("custom passes the manual markdown through",
  normalizeDiscount({ mode: "custom", regular: 700, discountType: "flat", discountValue: 150, comparisonPrice: 0 }),
  { regular: 700, type: "flat", value: 150 });
// Promotion mode zeroes the product's own markdown, because a leftover one would
// stack under the promotion's and the shopper would pay less than either
// advertised saving.
check("promotion clears any leftover product markdown",
  normalizeDiscount({ mode: "promotion", regular: 1000, discountType: "percentage", discountValue: 30, comparisonPrice: 0 }),
  { regular: 1000, type: "percentage", value: 0 });
check("none clears it too",
  normalizeDiscount({ mode: "none", regular: 1000, discountType: "flat", discountValue: 150, comparisonPrice: 0 }),
  { regular: 1000, type: "percentage", value: 0 });

// ---------------------------------------------------------------- 6
section(6, "the display helpers");
check("percentages round half away from zero, as Postgres does", roundPercent(12.5), 13);
check("and 14.8 becomes 15", roundPercent(14.8), 15);
check("a non-finite percentage is zero rather than NaN", roundPercent(NaN), 0);
check("money always carries two decimals", formatTaka(850), "৳ 850.00");
check("and groups thousands", formatTaka(1234567.5), "৳ 1,234,567.50");

console.log(fails === 0 ? "\nPRICING PARITY CHECKS PASS" : `\n${fails} FAILED`);
process.exitCode = fails === 0 ? 0 : 1;
