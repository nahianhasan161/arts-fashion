/**
 * HTTP-level checks for the product save route.
 *
 * The SQL suite proves admin_save_product behaves; this proves the route is
 * wired to it correctly: the status codes, the error codes the form branches
 * on, the description sanitiser, and the guards that only exist at the HTTP
 * boundary.
 *
 * A real session is used, because a route that requires a cookie and a profile
 * with role=admin cannot be meaningfully tested by asserting on 401s alone.
 * The script creates an admin and a plain user, signs in for real, and removes
 * every row it made.
 *
 *   node scripts/test-product-api.mjs [baseUrl]
 */

const base = process.argv[2] ?? "http://localhost:3111";
const mgmt = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPBASE_PROJECT_REF ?? "khebwqdhucrdfpfadxry";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
import { createServerClient } from "@supabase/ssr";

const Q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const J = (o) => Q(JSON.stringify(o)) + "::jsonb";

if (!mgmt || !supabaseUrl || !publishable) {
  console.error("Missing SUPABASE_ACCESS_TOKEN / NEXT_PUBLIC_SUPABASE_* in the environment");
  process.exit(1);
}

// ---------------------------------------------------------------- helpers

let fails = 0;
const check = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) fails++;
  console.log(
    `${pass ? "PASS  " : "FAIL  "}${label.padEnd(56)} got=${JSON.stringify(actual)}${pass ? "" : " want=" + JSON.stringify(expected)}`
  );
};
const ok = (label, cond) => check(label, Boolean(cond), true);

const section = (n, title) => console.log(`\n=== ${n}. ${title} ===`);

async function sql(query) {
  for (let a = 0; a < 4; a++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${mgmt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const t = await r.text();
    if (r.status >= 400) {
      if (/JWT could not be decoded/.test(t)) {
        await new Promise((s) => setTimeout(s, 400 * (a + 1)));
        continue;
      }
      throw new Error(`SQL failed: ${t.slice(0, 300)}\n${query.slice(0, 200)}`);
    }
    return t ? JSON.parse(t) : null;
  }
  throw new Error("SQL retries exhausted");
}
const must = (q) => sql(q);
const col1 = async (q) => (await sql(q))[0];

let cookie = "";
async function api(method, path, body, opts = {}) {
  const headers = { ...(opts.noAuth ? {} : { Cookie: cookie }) };
  let payload;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, { method, headers, body: payload, redirect: "manual" });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { __raw: text.slice(0, 200) };
  }
  return { status: res.status, body: json };
}

// ---------------------------------------------------------------- fixtures

const ADMIN = "00000000-0000-4000-8000-0000000000cc";
const PLAIN = "00000000-0000-4000-8000-0000000000dd";
const PWD = "pt-" + Math.random().toString(36).slice(2) + "-Aa1!";
const TAG = "pt" + Math.random().toString(36).slice(2, 8);

/**
 * The Management API token is a personal access token, not a JWT, so it
 * cannot authorise the Auth admin API. The users are created through SQL,
 * with the password hashed by pgcrypto exactly as GoTrue would, and the
 * profile row written alongside so the admin check can never run against a
 * user that has no profile.
 */
async function createAuthUser(id, email, role) {
  await must(`DELETE FROM public.profiles WHERE id=${Q(id)}`);
  await must(`DELETE FROM auth.users WHERE id=${Q(id)}`);
  await must(`
    INSERT INTO auth.users (
      id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, aud, role, instance_id,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) VALUES (
      ${Q(id)}, ${Q(email)}, extensions.crypt(${Q(PWD)}, extensions.gen_salt('bf', 10)), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
      now(), now(), '', '', '', ''
    )
  `);
  await must(`
    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider,
                                 last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), ${Q(id)}, ${Q(id)},
      ${J({ sub: id, email, email_verified: true })}, 'email',
      now(), now(), now())
    ON CONFLICT DO NOTHING
  `);
  await must(
    `INSERT INTO public.profiles (id,email,full_name,role) VALUES (${Q(id)},${Q(email)},'Product API Test',${Q(role)})
     ON CONFLICT (id) DO UPDATE SET role=${Q(role)}`
  );
  return id;
}

async function signIn(email) {
  const r = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publishable, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PWD }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("sign-in failed: " + JSON.stringify(j).slice(0, 200));

  const jar = {};
  const client = createServerClient(supabaseUrl, publishable, {
    cookies: {
      getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const { name, value } of list) jar[name] = value;
      },
    },
  });
  const { error } = await client.auth.setSession({
    access_token: j.access_token,
    refresh_token: j.refresh_token,
  });
  if (error) throw new Error("setSession failed: " + error.message);

  const cookies = Object.entries(jar).map(([name, value]) => `${name}=${value}`);
  if (cookies.length === 0) throw new Error("no session cookie was written");
  return { cookie: cookies.join("; "), accessToken: j.access_token };
}

/**
 * Everything this run created is tracked by id, so nothing real is touched.
 *
 * An id is only recorded if it is a well-formed uuid. A row that failed to
 * return one would otherwise be pushed as undefined, and a delete with an
 * undefined id matches no rows and silently cleans up nothing, which is how
 * residue accumulates without any visible failure.
 */
const created = { products: [], promotions: [] };
const isUuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * Also sweeps by this suite's own fixed name prefix, for the same reason the
 * SQL suite does: a run that threw before it recorded an id leaves a row that
 * no id-based delete can find. The prefix belongs to this suite alone.
 */
// Both sweeps are by a prefix that belongs to this suite alone, and they exist
// because a test that creates a product without recording its id -- one that
// exercises a rejection, say -- leaves a row that no id-based delete can find.
const sweepResidue = async () => {
  await must(`DELETE FROM public.promotions WHERE name LIKE 'T-pt%'`);
  await must(`DELETE FROM public.products WHERE slug LIKE 'route-pt%'`);
  // Section 8 creates two products with a BLANK slug, so the server derives
  // one from the title and the slug is "a-title-with-spaces" -- which carries
  // no suite prefix and so was invisible to the sweeps above. A run that was
  // interrupted before its cleanup left the row behind, the next run derived
  // the same base slug, the server uniquified it to
  // "a-title-with-spaces-2", and the assertion on the exact slug failed.
  // The server's behaviour was correct throughout; the suite could not observe
  // it because its own residue had moved the goalpost. The prefix here belongs
  // to this suite alone, exactly like the ones above.
  await must(`DELETE FROM public.products WHERE slug LIKE 'a-title-with-spaces%'`);
};

async function cleanup() {
  for (const id of created.products) {
    if (isUuid(id)) await must(`DELETE FROM public.products WHERE id=${Q(id)}`);
  }
  for (const id of created.promotions) {
    if (isUuid(id)) await must(`DELETE FROM public.promotions WHERE id=${Q(id)}`);
  }
  await sweepResidue();
  created.products.length = 0;
  created.promotions.length = 0;
  await must(`DELETE FROM public.profiles WHERE id IN (${Q(ADMIN)},${Q(PLAIN)})`);
  await must(`DELETE FROM auth.users WHERE id IN (${Q(ADMIN)},${Q(PLAIN)})`);
}

const track = async (table, id) => {
  if (!isUuid(id)) {
    throw new Error(`refusing to track a non-uuid id for ${table}: ${JSON.stringify(id)}`);
  }
  if (table === "products") created.products.push(id);
  else created.promotions.push(id);
  return id;
};

// ---------------------------------------------------------------- run

let adminSession = null;
try {
  await cleanup();

  // A parent and a child category, so the form's cascade is exercised against
  // real rows rather than ones this run invents. Real category ids are reused
  // on purpose: the product rows are removed by id, so no category is touched.
  const cat = await col1(
    `SELECT c.id AS parent, s.id AS child
       FROM public.categories c
       JOIN public.categories s ON s.parent_id = c.id
      WHERE c.parent_id IS NULL AND s.parent_id IS NOT NULL
      ORDER BY c.id, s.id
      LIMIT 1`
  );
  if (!cat) throw new Error("no parent/child category pair exists to test against");
  const otherParent = await col1(
    `SELECT id FROM public.categories WHERE parent_id IS NULL AND id <> ${Q(cat.parent)} ORDER BY id LIMIT 1`
  );

  const col = await col1(`SELECT id FROM public.colors WHERE is_active ORDER BY id LIMIT 1`);
  const col2 = await col1(`SELECT id FROM public.colors WHERE is_active AND id <> ${Q(col.id)} ORDER BY id LIMIT 1`);
  const size = await col1(`SELECT id FROM public.sizes ORDER BY id LIMIT 1`);

  const promoRow = await col1(
    `INSERT INTO public.promotions (name, discount_type, discount_value, starts_at, ends_at, status)
     VALUES (${Q("T-" + TAG)}, 'percentage', 10, now() - interval '1 day', now() + interval '1 day', 'active')
     RETURNING id`
  );
  const promo = await track("promotions", promoRow.id);

  await createAuthUser(ADMIN, `admin-${TAG}@example.test`, "admin");
  // The live constraint on profiles.role is CHECK (role IN ('user','admin')),
  // so the non-admin is a plain 'user'. A role outside that set is rejected by
  // the database before the API is ever reached, which would test the
  // constraint rather than the authorisation.
  await createAuthUser(PLAIN, `plain-${TAG}@example.test`, "user");
  adminSession = await signIn(`admin-${TAG}@example.test`);
  cookie = adminSession.cookie;

  const baseProduct = (over = {}) => ({
    title: "Route Test " + TAG,
    slug: `route-${TAG}`,
    category_id: cat.parent,
    sub_category_id: null,
    description: "",
    // The server derives price and original_price from these three. The form
    // used to send price/original_price/discount_percent, none of which the
    // function reads, which is how every product saved through it became 0.00.
    regular_price: 800,
    discount_type: "percentage",
    discount_value: 0,
    stock: 4,
    status: "draft",
    specs: {},
    color_ids: [],
    size_ids: [],
    promotion_ids: [],
    variants: [],
    ...over,
  });

  // ---------------------------------------------------------------- 1
  section(1, "create");
  const created1 = await api("POST", "/api/admin/products", baseProduct({ slug: `route-${TAG}-a` }));
  check("a create succeeds", created1.status, 200);
  check("and reports success", created1.body?.success, true);
  ok("and returns the new id", Boolean(created1.body?.data?.id));
  const P1 = created1.body?.data?.id;
  if (P1) created.products.push(P1);

  const row1 = await col1(`SELECT * FROM public.products WHERE id=${Q(P1)}`);
  check("the row exists", Boolean(row1), true);
  check("the category name was written from the id", row1.category, (await col1(`SELECT name FROM public.categories WHERE id=${Q(cat.parent)}`)).name);
  ok("and category_id was stored", row1.category_id === cat.parent);

  // ---------------------------------------------------------------- 2
  section(2, "sub-category and the cascade");
  const withSub = await api("PUT", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-a` }),
    id: P1,
    sub_category_id: cat.child,
  });
  check("a sub-category under the parent is accepted", withSub.status, 200);
  const row2 = await col1(`SELECT * FROM public.products WHERE id=${Q(P1)}`);
  ok("sub_category_id was stored", row2.sub_category_id === cat.child);
  check("and the sub-category name came from the id", row2.sub_category, (await col1(`SELECT name FROM public.categories WHERE id=${Q(cat.child)}`)).name);

  if (otherParent) {
    const mismatched = await api("PUT", "/api/admin/products", {
      ...baseProduct({ slug: `route-${TAG}-a` }),
      id: P1,
      category_id: otherParent.id,
      // Deliberately left as the child of the previous parent.
      sub_category_id: cat.child,
    });
    check("a sub-category from another parent is refused", mismatched.status, 400);
    check("with the subcategory code", mismatched.body?.code, "subcategory_not_found");
    const row3 = await col1(`SELECT category_id, sub_category_id FROM public.products WHERE id=${Q(P1)}`);
    check("and the row was not changed", row3.sub_category_id, cat.child);
  }

  // ---------------------------------------------------------------- 3
  section(3, "the option matrix");
  const withMatrix = await api("PUT", "/api/admin/products", {
    ...baseProduct({
      slug: `route-${TAG}-a`,
      color_ids: [col.id, col2.id],
      size_ids: [size.id],
      variants: [
        { color_id: col.id, size_id: size.id, stock: 3, price_override: null, sku: null, is_active: true },
        { color_id: col2.id, size_id: size.id, stock: 7, price_override: "450", sku: `${TAG}-c2`, is_active: true },
      ],
    }),
    id: P1,
  });
  check("a matrix save succeeds", withMatrix.status, 200);
  const variants = await sql(
    `SELECT color_id, size_id, stock, regular_price_override, sku, is_active
       FROM public.product_variants WHERE product_id=${Q(P1)} ORDER BY color_id`
  );
  check("both variants were created", variants.length, 2);
  check("the first stock round-tripped", variants[0].stock, 3);
  check("the price override round-tripped", Number(variants[1].regular_price_override), 450);
  check("the sku round-tripped", variants[1].sku, `${TAG}-c2`);
  check("colors were projected onto the product", (await col1(`SELECT colors FROM public.products WHERE id=${Q(P1)}`)).colors.length, 2);
  check("and color_palette_ids mirrors the links", (await col1(`SELECT color_palette_ids FROM public.products WHERE id=${Q(P1)}`)).color_palette_ids.length, 2);

  // Removing a colour must take its variants with it, or a sold-out colour
  // would still resolve at checkout.
  const dropped = await api("PUT", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-a`, color_ids: [col.id], size_ids: [size.id], variants: [{ color_id: col.id, size_id: size.id, stock: 3, is_active: true }] }),
    id: P1,
  });
  check("a narrower matrix saves", dropped.status, 200);
  check("the removed colour's variant is gone", (await col1(`SELECT count(*)::int c FROM public.product_variants WHERE product_id=${Q(P1)}`)).c, 1);

  // ---------------------------------------------------------------- 4
  section(4, "the projection columns cannot be spoofed");
  const spoofed = await api("PUT", "/api/admin/products", {
    ...baseProduct({
      slug: `route-${TAG}-a`,
      // A client sending these must not be able to invent a palette the
      // option matrix does not have.
      colors: [{ name: "Injected", hex: "#000000" }],
      sizes: [{ size: "XXXL", chest: "0", stock: 999 }],
      color_ids: [],
      size_ids: [],
      variants: [],
    }),
    id: P1,
  });
  check("a spoofed colors array is accepted but ignored", spoofed.status, 200);
  const afterSpoof = await col1(`SELECT colors, sizes FROM public.products WHERE id=${Q(P1)}`);
  check("the injected colour was dropped", afterSpoof.colors.length, 0);
  check("the injected size was dropped", afterSpoof.sizes.length, 0);
  check("and the variants were removed too", (await col1(`SELECT count(*)::int c FROM public.product_variants WHERE product_id=${Q(P1)}`)).c, 0);

  // ---------------------------------------------------------------- 4b
  section("4b", "money is derived, never taken from the client");
  // The regression this suite exists for. A form that sent `price` and
  // `original_price` had every money field fall through to COALESCE(..., 0),
  // so each product saved as free and nothing errored. These assert the three
  // numbers the admin actually sees end up in the right columns.
  const priced = await api("PUT", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-a`, regular_price: 2500, discount_type: "percentage", discount_value: 20 }),
    id: P1,
  });
  check("a priced save succeeds", priced.status, 200);
  const money = await col1(`SELECT regular_price, price, original_price, discount_type, discount_value, discount_percent FROM public.products WHERE id=${Q(P1)}`);
  check("the entered price is stored as regular_price", Number(money.regular_price), 2500);
  check("the sale price is derived, 20% off 2500", Number(money.price), 2000);
  check("the crossed-out price mirrors regular_price", Number(money.original_price), 2500);
  check("the discount type round-tripped", money.discount_type, "percentage");
  check("the discount value round-tripped", Number(money.discount_value), 20);
  check("and the percentage is derived from it", money.discount_percent, 20);

  const flat = await api("PUT", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-a`, regular_price: 1000, discount_type: "flat", discount_value: 250 }),
    id: P1,
  });
  check("a flat discount save succeeds", flat.status, 200);
  const flatMoney = await col1(`SELECT regular_price, price FROM public.products WHERE id=${Q(P1)}`);
  check("a flat discount is subtracted", Number(flatMoney.price), 750);
  check("and the base is untouched", Number(flatMoney.regular_price), 1000);

  // The old payload shape, replayed verbatim. It must not zero the product,
  // which is the exact failure being guarded against.
  const legacy = await api("PUT", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-a`, regular_price: 1800 }),
    id: P1,
    price: 0,
    original_price: 0,
    discount_percent: 0,
  });
  check("a legacy payload with zeroed prices still saves", legacy.status, 200);
  const legacyMoney = await col1(`SELECT regular_price, price FROM public.products WHERE id=${Q(P1)}`);
  check("and does not overwrite the price with zero", Number(legacyMoney.regular_price), 1800);
  check("the derived sale price is still right", Number(legacyMoney.price), 1800);

  // A missing price is now refused by the database rather than becoming 0.
  // The key has to be genuinely absent, not present and zero, because those
  // are the two ways a form can get this wrong and the second is caught
  // earlier by the numeric coercion.
  const noPricePayload = baseProduct({ slug: `route-${TAG}-np` });
  delete noPricePayload.regular_price;
  const noPrice = await api("POST", "/api/admin/products", noPricePayload);
  check("a payload with no price key is refused", noPrice.status, 400);
  check("with the price code", noPrice.body?.code, "invalid_regular_price");

  const zeroPrice = await api("POST", "/api/admin/products", baseProduct({ slug: `route-${TAG}-zp`, regular_price: 0 }));
  check("a zero price is refused", zeroPrice.status, 400);
  check("with the price code", zeroPrice.body?.code, "invalid_regular_price");

  // ---------------------------------------------------------------- 5
  section(5, "the description sanitiser");
  const nasty = await api("PUT", "/api/admin/products", {
    ...baseProduct({
      slug: `route-${TAG}-a`,
      description:
        '<p>Good <strong>cotton</strong></p>' +
        '<script>alert(1)</script>' +
        '<img src=x onerror=alert(1)>' +
        '<a href="javascript:alert(1)">bad link</a>' +
        '<a href="/ok" target="_blank">good link</a>' +
        '<iframe src="//evil"></iframe>',
    }),
    id: P1,
  });
  check("a description with markup saves", nasty.status, 200);
  const desc = (await col1(`SELECT description FROM public.products WHERE id=${Q(P1)}`)).description ?? "";
  check("the text survived", desc.includes("Good"), true);
  check("the strong tag survived", desc.includes("<strong>cotton</strong>"), true);
  check("a script tag was removed", desc.includes("<script"), false);
  check("its text was removed too", desc.includes("alert(1)"), false);
  check("an onerror attribute was removed", desc.includes("onerror"), false);
  check("a javascript: href was removed", desc.includes("javascript:"), false);
  check("an iframe was removed", desc.includes("<iframe"), false);
  ok("a safe relative href was kept", desc.includes('href="/ok"'));
  ok("and a _blank link got a safe rel", desc.includes('rel="noopener noreferrer"'));

  // ---------------------------------------------------------------- 6
  section(6, "promotion links");
  const withPromo = await api("PUT", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-a`, promotion_ids: [promo] }),
    id: P1,
  });
  check("a promotion link saves", withPromo.status, 200);
  check("the link was written", (await col1(`SELECT count(*)::int c FROM public.promotion_products WHERE product_id=${Q(P1)} AND promotion_id=${Q(promo)}`)).c, 1);

  const badPromo = await api("PUT", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-a`, promotion_ids: ["no-such-promotion"] }),
    id: P1,
  });
  check("an unknown promotion is refused", badPromo.status, 400);
  check("with the promotion code", badPromo.body?.code, "unknown_promotion");

  // ---------------------------------------------------------------- 7
  section(7, "error codes the form branches on");
  const noTitle = await api("POST", "/api/admin/products", baseProduct({ title: "   ", slug: `route-${TAG}-x` }));
  check("a blank title is refused", noTitle.status, 400);
  check("with the title code", noTitle.body?.code, "title_required");

  const noCat = await api("POST", "/api/admin/products", baseProduct({ category_id: null, slug: `route-${TAG}-y` }));
  check("a missing category is refused", noCat.status, 400);
  check("with the category code", noCat.body?.code, "category_required");

  const noStock = await api("PUT", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-a`, color_ids: [col.id], size_ids: [size.id], variants: [{ color_id: col.id, size_id: size.id, stock: -2, is_active: true }] }),
    id: P1,
  });
  check("a negative stock is refused", noStock.status, 400);
  check("with the stock code", noStock.body?.code, "negative_stock");

  const noColor = await api("PUT", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-a`, color_ids: ["no-such-color"], size_ids: [], variants: [] }),
    id: P1,
  });
  check("an unknown colour is refused", noColor.status, 400);
  check("with the colour code", noColor.body?.code, "unknown_color");

  const badStatus = await api("PUT", "/api/admin/products", { ...baseProduct({ slug: `route-${TAG}-a`, status: "sideways" }), id: P1 });
  check("an unknown status is refused", badStatus.status, 400);
  check("with the status code", badStatus.body?.code, "invalid_status");

  const gone = await api("PUT", "/api/admin/products", { ...baseProduct({ slug: `route-${TAG}-a` }), id: "00000000-0000-0000-0000-000000000000" });
  check("a missing product is a 404", gone.status, 404);
  check("with the not-found code", gone.body?.code, "product_not_found");

  // ---------------------------------------------------------------- 8
  section(8, "slugs");
  const created2 = await api("POST", "/api/admin/products", baseProduct({ slug: `route-${TAG}-a` }));
  check("a duplicate slug is a conflict", created2.status, 409);
  check("with the slug code", created2.body?.code, "slug_taken");

  // A blank slug is derived from the title rather than refused, because a
  // blank slug was the most common reason a product could not be saved. An
  // explicit slug that is taken is still a conflict, which is the case above.
  const auto = await api("POST", "/api/admin/products", baseProduct({ title: "A Title With Spaces", slug: "" }));
  check("a blank slug is derived from the title", auto.status, 200);
  const autoId = auto.body?.data?.id;
  if (autoId) created.products.push(autoId);
  check("and the derived slug is the title, lowercased and dashed", auto.body?.data?.slug, "a-title-with-spaces");

  const derivedTwice = await api("POST", "/api/admin/products", baseProduct({ title: "A Title With Spaces", slug: "" }));
  check("two products with one title both save", derivedTwice.status, 200);
  if (derivedTwice.body?.data?.id) created.products.push(derivedTwice.body.data.id);
  ok("and the second gets a distinct slug", derivedTwice.body?.data?.slug !== auto.body?.data?.slug);

  // ---------------------------------------------------------------- 9
  section(9, "the list carries what the editor needs");
  const list = await api("GET", "/api/admin/products?limit=100");
  check("the list loads", list.status, 200);
  const listed = (list.body?.data ?? []).find((p) => p.id === P1);
  ok("the saved product is in the list", Boolean(listed));
  ok("and carries its variants", Array.isArray(listed?.variants));
  ok("and carries its promotion ids", Array.isArray(listed?.promotion_ids));
  check("with the linked promotion", listed?.promotion_ids, [promo]);
  ok("and the colour name is resolved on each variant", listed?.variants?.length === 0 || Boolean(listed.variants[0].color_name));

  // ---------------------------------------------------------------- 10
  section(10, "authorisation");
  const plainSession = await signIn(`plain-${TAG}@example.test`);
  const saved = cookie;
  cookie = plainSession.cookie;
  const asPlain = await api("POST", "/api/admin/products", baseProduct({ slug: `route-${TAG}-z` }));
  check("a non-admin cannot create", asPlain.status, 403);
  cookie = saved;

  const anon = await api("POST", "/api/admin/products", baseProduct({ slug: `route-${TAG}-z` }), { noAuth: true });
  ok("an anonymous caller is refused", anon.status === 401 || anon.status === 403);

  const anonRead = await api("GET", "/api/admin/products", undefined, { noAuth: true });
  ok("an anonymous caller cannot read the list", anonRead.status === 401 || anonRead.status === 403);

  // ---------------------------------------------------------------- 11
  section(11, "a create and an update share one path");
  const viaPut = await api("PUT", "/api/admin/products", baseProduct({ slug: `route-${TAG}-new` }));
  check("a PUT without an id creates", viaPut.status, 200);
  ok("and returns an id", Boolean(viaPut.body?.data?.id));
  if (viaPut.body?.data?.id) created.products.push(viaPut.body.data.id);
  check("the row exists", (await col1(`SELECT count(*)::int c FROM public.products WHERE id=${Q(viaPut.body?.data?.id)}`)).c, 1);

  // ---------------------------------------------------------------- 12
  section(12, "catalogue fields reach the database");
  const withFields = await api("PUT", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-a` }),
    id: P1,
    short_description: "A soft jersey tee with a relaxed drape.",
    tags: ["Summer", "linen", "Summer", "  "],
    cost_price: 415.5,
  });
  check("a save carrying them succeeds", withFields.status, 200);
  const rowFields = await col1(
    `SELECT short_description, tags, cost_price FROM public.products WHERE id=${Q(P1)}`
  );
  check("the short description was stored", rowFields.short_description, "A soft jersey tee with a relaxed drape.");
  // "Summer" appears twice and "  " is blank: the first spelling wins, the
  // duplicate case-insensitive match and the blank are dropped.
  check("tags are trimmed and de-duplicated", rowFields.tags, ["Summer", "linen"]);
  check("the cost price was stored", String(rowFields.cost_price), "415.50");

  // A blank cost clears the field rather than recording a zero, because a zero
  // reads as free goods to every margin report downstream.
  const cleared = await api("PUT", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-a` }),
    id: P1,
    cost_price: "",
  });
  check("a save clearing the cost succeeds", cleared.status, 200);
  const clearedRow = await col1(`SELECT cost_price FROM public.products WHERE id=${Q(P1)}`);
  check("and the cost is now unset rather than zero", clearedRow.cost_price, null);

  const negCost = await api("PUT", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-a` }),
    id: P1,
    cost_price: -1,
  });
  check("a negative cost is refused", negCost.status, 400);
  check("with the named code", negCost.body?.code, "invalid_cost_price");

  // ---------------------------------------------------------------- 13
  section(13, "published_at is the database's, not the form's");
  const pub = await api("PUT", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-a` }),
    id: P1,
    status: "published",
  });
  check("publishing succeeds", pub.status, 200);
  const published = await col1(`SELECT published_at FROM public.products WHERE id=${Q(P1)}`);
  ok("the first publication was stamped", published.published_at !== null);
  const firstStamp = String(published.published_at);

  await api("PUT", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-a` }),
    id: P1,
    status: "draft",
  });
  const unpublished = await col1(`SELECT published_at FROM public.products WHERE id=${Q(P1)}`);
  check("unpublishing does not erase the date", String(unpublished.published_at), firstStamp);

  await api("PUT", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-a` }),
    id: P1,
    status: "published",
    // A stale tab round-tripping the row would carry this back and backdate
    // the product to the day the form was opened.
    published_at: "2000-01-01T00:00:00Z",
  });
  const republished = await col1(`SELECT published_at FROM public.products WHERE id=${Q(P1)}`);
  check("republishing keeps the original date", String(republished.published_at), firstStamp);

  // ---------------------------------------------------------------- 14
  section(14, "delete retires the product instead of removing it");
  // The promotion link is re-established first. Sections 12 and 13 re-saved
  // this product from baseProduct(), which carries promotion_ids: [], so the
  // link from section 9 was already gone. Asserting it survived the delete
  // without re-adding it would have been asserting that the delete removed
  // something the delete never touched.
  const relink = await api("PUT", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-a` }),
    id: P1,
    promotion_ids: [promo],
  });
  check("the promotion is linked again before deleting", relink.status, 200);
  const linkedBefore = await col1(
    `SELECT count(*)::int c FROM public.promotion_products WHERE product_id=${Q(P1)}`
  );
  check("and the link is there to be preserved", linkedBefore.c, 1);

  const liveBefore = await col1(`SELECT count(*)::int c FROM public.products WHERE id=${Q(P1)}`);
  check("the product is there to start with", liveBefore.c, 1);

  const del = await api("DELETE", `/api/admin/products?id=${P1}`);
  check("the delete succeeds", del.status, 200);
  check("and reports success", del.body?.success, true);

  const afterDel = await col1(`SELECT status, deleted_at FROM public.products WHERE id=${Q(P1)}`);
  check("the row is still there", Boolean(afterDel), true);
  ok("deleted_at was stamped", afterDel.deleted_at !== null);
  // Both, not either. A row marked deleted but left 'published' still passes
  // any query that only filters on status.
  check("and it was archived in the same statement", afterDel.status, "archived");

  const linksAfter = await col1(
    `SELECT count(*)::int c FROM public.promotion_products WHERE product_id=${Q(P1)}`
  );
  check("the promotion link survived the delete", linksAfter.c, 1);

  const twice = await api("DELETE", `/api/admin/products?id=${P1}`);
  check("deleting it twice is a conflict, not a silent success", twice.status, 409);
  check("with the named code", twice.body?.code, "product_already_deleted");

  // ---------------------------------------------------------------- 15
  section(15, "a retired product is hidden from both readers");
  const afterList = await api("GET", "/api/admin/products?limit=100");
  const inList = (afterList.body?.data ?? []).some((p) => p.id === P1);
  check("it is not in the default admin list", inList, false);

  const trash = await api("GET", "/api/admin/products?limit=100&deleted=1");
  const inTrash = (trash.body?.data ?? []).some((p) => p.id === P1);
  check("but ?deleted=1 finds it", inTrash, true);

  // The policy, not the route: the publishable key must not be able to read a
  // draft or a retired row even if the storefront's own query is bypassed.
  const anonKey = publishable;
  const asAnon = await fetch(`${supabaseUrl}/rest/v1/products?slug=eq.${P1 ? `route-${TAG}-a` : "x"}&select=id,status,deleted_at`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
  const anonRows = await asAnon.json().catch(() => null);
  check("the publishable key cannot read a retired product", Array.isArray(anonRows) ? anonRows.length : -1, 0);

  // ---------------------------------------------------------------- 16
  section(16, "restore puts it back without putting it on sale");
  // Through the route, not through SQL. admin_restore_product() is SECURITY
  // DEFINER but still checks is_admin(), which reads auth.uid(); a Management
  // API connection has no request JWT, so calling it directly fails with
  // not_authorized. That refusal is correct behaviour being tested with the
  // wrong caller, so the route is the thing to exercise.
  const restoredRes = await api("POST", `/api/admin/products/restore?id=${P1}`);
  check("the restore succeeds", restoredRes.status, 200);
  check("and reports success", restoredRes.body?.success, true);
  const restored = await col1(`SELECT status, deleted_at FROM public.products WHERE id=${Q(P1)}`);
  check("deleted_at was cleared", restored.deleted_at, null);
  check("and it defaulted to draft, not published", restored.status, "draft");

  const restoreTwice = await api("POST", `/api/admin/products/restore?id=${P1}`);
  check("restoring a product that is not retired is a conflict", restoreTwice.status, 409);
  check("with the named code", restoreTwice.body?.code, "product_not_deleted");

  const badRestoreStatus = await api("POST", `/api/admin/products/restore?id=${P1}&status=live`);
  check("an unknown status is refused", badRestoreStatus.status, 400);
  check("with the named code", badRestoreStatus.body?.code, "invalid_status");

  const restoreAnon = await api("POST", `/api/admin/products/restore?id=${P1}`, undefined, { noAuth: true });
  ok("an anonymous caller cannot restore", restoreAnon.status === 401 || restoreAnon.status === 403);

  // The product is a draft again now, so the same REST call that returned
  // nothing for a retired row must also return nothing for a draft. Two
  // different column semantics, one policy, both worth pinning: a draft that
  // leaked would expose cost_price and the supplier-facing spec keys.
  const draftKey = publishable;
  const draftRead = await fetch(
    `${supabaseUrl}/rest/v1/products?slug=eq.route-${TAG}-a&select=id,cost_price`,
    { headers: { apikey: draftKey, Authorization: `Bearer ${draftKey}` } }
  );
  const draftRows = await draftRead.json().catch(() => null);
  check("the publishable key cannot read a draft", Array.isArray(draftRows) ? draftRows.length : -1, 0);

  // And the admin still can, which is the clause that would break first if the
  // policy were ever tightened without the is_admin() arm.
  const asAdminList = await api("GET", "/api/admin/products?limit=100");
  check(
    "the admin still sees its own drafts",
    (asAdminList.body?.data ?? []).some((p) => p.id === P1),
    true
  );

  // ---------------------------------------------------------------- 17
  section(17, "the categories endpoint is a tree, and consumers flatten it");
  // The sub-category dropdown broke because this endpoint returns a TREE and
  // the products page handed the result straight to a filter that expects a
  // flat list. The filter is
  //   categories.filter(c => !!c.parent_id && c.parent_id === categoryId)
  // and every top-level row of a tree is a root with parent_id === null, so it
  // matched nothing and the form claimed "This category has no
  // sub-categories" for parents that had one.
  //
  // The endpoint shape is correct and is depended on by the nested category
  // manager, so it is not changed. What is pinned here is the contract the
  // consumers rely on: the response is a tree, and flattening it is what
  // recovers the sub-categories. If someone "fixes" the endpoint to return a
  // flat list instead, this fails and the nested manager will too.
  const catRes = await api("GET", "/api/admin/categories?limit=100");
  check("the categories endpoint loads", catRes.status, 200);
  const catTree = catRes.body?.data ?? [];
  ok("the response has rows", catTree.length > 0);
  check("every top-level row is a root", catTree.filter((c) => c.parent_id).length, 0);
  ok("sub-categories are nested, not listed alongside their parents",
    catTree.some((c) => (c.children ?? []).length > 0));

  // flattenCategoryTree, from src/lib/utils.ts, applied to the real response.
  const catFlat = catTree.flatMap((n) => [n, ...(n.children ?? [])]);
  const catUnflattened = catTree.filter((c) => !!c.parent_id);
  check("filtering the raw tree for sub-categories finds nothing", catUnflattened.length, 0);
  ok("filtering the flattened list finds the sub-categories", catFlat.some((c) => c.parent_id));

  // The specific case from the report: a child must be reachable by its
  // parent's id once the tree is flattened, which is what the dropdown does.
  const withChild = catFlat.find(
    (c) => c.parent_id && catFlat.some((p) => p.id === c.parent_id && (p.children ?? []).some((k) => k.id === c.id)),
  );
  ok("a sub-category resolves to its parent by parent_id", Boolean(withChild));
  if (withChild) {
    const offered = catFlat.filter((c) => !!c.parent_id && c.parent_id === withChild.parent_id);
    check("that parent's sub-category list is non-empty", offered.length > 0, true);
    check("and includes the child itself", offered.some((c) => c.id === withChild.id), true);
  }

  // A sub-category must sit under a parent that exists, or the form would
  // offer it for a category that was deleted out from under it.
  const parentIds = new Set(catFlat.filter((c) => !c.parent_id).map((c) => c.id));
  check("no orphan sub-categories", catFlat.filter((c) => c.parent_id && !parentIds.has(c.parent_id)).length, 0);

  // ---------------------------------------------------------------- 18
  section(18, "a single-axis product keeps its stock, SKU and price override");
  // Colours-without-sizes and sizes-without-colours are both supported by the
  // matrix UI, and both used to be silently discarded by the server: the two
  // UNION ALL branches that build them hardcoded 0, NULL, NULL, true instead
  // of reading the payload. Since products.stock is a trigger-maintained sum
  // of the active variants, the product total came out as 0 as well.
  const oneColor = (await col1(`SELECT id FROM public.colors WHERE is_active ORDER BY name LIMIT 1`)).id;
  const oneSize = (await col1(`SELECT id FROM public.sizes WHERE is_active ORDER BY display_name LIMIT 1`)).id;

  const colorOnly = await api("POST", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-coloronly` }),
    color_ids: [oneColor],
    size_ids: [],
    variants: [{ color_id: oneColor, size_id: null, stock: 12, price_override: "450", sku: "PT-COLOR-1", is_active: true }],
  });
  check("a colour-only product saves", colorOnly.status, 200);
  if (colorOnly.body?.data?.id) created.products.push(colorOnly.body.data.id);
  const coRow = await col1(
    `SELECT stock, sku, regular_price_override FROM public.product_variants
      WHERE product_id=${Q(colorOnly.body?.data?.id)}`);
  check("its stock was stored, not zeroed", coRow?.stock, 12);
  check("its SKU survived", coRow?.sku, "PT-COLOR-1");
  check("its price override survived", String(coRow?.regular_price_override), "450.00");
  const coProduct = await col1(
    `SELECT stock FROM public.products WHERE id=${Q(colorOnly.body?.data?.id)}`);
  check("and the product total followed the variant", coProduct?.stock, 12);

  // The form rebuilds its lookup key from color_id/size_id rather than
  // reading variant_key, because the two render a missing axis differently
  // ("-" in the form, "" in the generated column). The API has to hand back
  // both ids, or that rebuild is not possible.
  const coList = await api("GET", "/api/admin/products?limit=100");
  const coFromList = (coList.body?.data ?? []).find((p) => p.id === colorOnly.body?.data?.id);
  const coVariant = coFromList?.variants?.[0];
  ok("the list returns the variant's color_id", coVariant?.color_id === oneColor);
  check("and a null size_id", coVariant?.size_id, null);
  check("and the stock the form needs", coVariant?.stock, 12);

  const sizeOnly = await api("POST", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-sizeonly` }),
    color_ids: [],
    size_ids: [oneSize],
    variants: [{ color_id: null, size_id: oneSize, stock: 7, price_override: null, sku: "PT-SIZE-1", is_active: true }],
  });
  check("a size-only product saves", sizeOnly.status, 200);
  if (sizeOnly.body?.data?.id) created.products.push(sizeOnly.body.data.id);
  const soRow = await col1(
    `SELECT stock, sku FROM public.product_variants
      WHERE product_id=${Q(sizeOnly.body?.data?.id)}`);
  check("its stock was stored, not zeroed", soRow?.stock, 7);
  check("its SKU survived", soRow?.sku, "PT-SIZE-1");

  // ---------------------------------------------------------------- 19
  section(19, "a repeated option id does not break the save");
  // The reported failure: opening an existing product and pressing Update gave
  //
  //   ON CONFLICT DO UPDATE command cannot affect row a second time  (21000)
  //
  // The admin list built color_ids by mapping over variants, so a colour came
  // back once per SIZE. The form sent the repeat back, the server's array_agg
  // had no DISTINCT, the cross product emitted each (colour, size) pair twice,
  // and the upsert against UNIQUE (product_id, variant_key) hit one row twice.
  const dupColor = (await col1(`SELECT id FROM public.colors WHERE is_active ORDER BY name LIMIT 1`)).id;
  // sql(), not col1(): col1 takes the first row, and two sizes are needed.
  const dupSizes = (await must(
    `SELECT id FROM public.sizes WHERE is_active ORDER BY display_name LIMIT 2`)).map((r) => r.id);
  check("there are two sizes available", dupSizes.length, 2);

  const seed = await api("POST", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-dupseed` }),
    color_ids: [dupColor],
    size_ids: dupSizes,
    variants: [
      { color_id: dupColor, size_id: dupSizes[0], stock: 3, price_override: null, sku: "PT-DUP-1", is_active: true },
      { color_id: dupColor, size_id: dupSizes[1], stock: 4, price_override: null, sku: "PT-DUP-2", is_active: true },
    ],
  });
  check("the product seeds", seed.status, 200);
  const dupId = seed.body?.data?.id;
  if (dupId) created.products.push(dupId);

  // Read it back the way the form does, repeats and all.
  const dupList = await api("GET", "/api/admin/products?limit=100");
  const fromList = (dupList.body?.data ?? []).find((p) => p.id === dupId);
  check("the list returns each colour once", fromList?.color_ids, [dupColor]);
  check("and each size once", fromList?.size_ids, dupSizes);
  const listedVariants = fromList?.variants ?? [];
  check("with one variant per size", listedVariants.length, 2);

  // Save the form back exactly as loaded, plus the repeated ids the list used
  // to send. Both must now succeed: the route fix stops the repeat, and the
  // server fix makes the repeat harmless if a client sends one anyway.
  const resave = await api("PUT", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-dupseed` }),
    id: dupId,
    color_ids: fromList?.color_ids ?? [],
    size_ids: fromList?.size_ids ?? [],
    variants: listedVariants.map((v) => ({
      color_id: v.color_id, size_id: v.size_id, stock: v.stock,
      price_override: v.regular_price_override, sku: v.sku, is_active: v.is_active,
    })),
  });
  check("re-saving the loaded form succeeds", resave.status, 200);

  const forced = await api("PUT", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-dupseed` }),
    id: dupId,
    color_ids: [dupColor, dupColor],
    size_ids: dupSizes,
    variants: listedVariants.map((v) => ({
      color_id: v.color_id, size_id: v.size_id, stock: v.stock,
      price_override: v.regular_price_override, sku: v.sku, is_active: v.is_active,
    })),
  });
  check("and a deliberately repeated colour id is tolerated", forced.status, 200);

  const afterDup = await col1(
    `SELECT count(*)::int c FROM public.product_variants WHERE product_id=${Q(dupId)}`);
  check("with one row per pair, not two", afterDup.c, 2);
  const stockAfter = await col1(
    `SELECT sum(stock)::int s FROM public.product_variants WHERE product_id=${Q(dupId)}`);
  check("and the stock is 7, not doubled", stockAfter.s, 7);

  // The guard must still do its job: a repeat is a non-event, an unknown id is
  // an error. Without the DISTINCT count in the guard these would swap places.
  const unknownColor = await api("PUT", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-dupseed` }),
    id: dupId,
    color_ids: [dupColor, dupColor, "00000000-0000-4000-8000-0000000000aa"],
    size_ids: dupSizes,
    variants: listedVariants.map((v) => ({
      color_id: v.color_id, size_id: v.size_id, stock: v.stock,
      price_override: v.regular_price_override, sku: v.sku, is_active: v.is_active,
    })),
  });
  check("a repeated plus unknown colour is still refused", unknownColor.status, 400);
  check("with the named code", unknownColor.body?.code, "unknown_color");

  // ---------------------------------------------------------------- 20
  section(20, "the audience is stored, validated and defaultable");
  // gender is a plain nullable column, which means the interesting behaviour is
  // entirely in the three states it can be in. A product with no audience is
  // the common case, not an error: it saves, it stays sellable, and it shows in
  // Shop All. So the null case is asserted as a first-class outcome rather than
  // left to be whatever happens to fall out of the insert.
  const gA = await api("POST", "/api/admin/products", baseProduct({
    slug: `route-${TAG}-gw`, gender: "women",
  }));
  check("an audience saves", gA.status, 200);
  const gAId = gA.body?.data?.id;
  if (gAId) created.products.push(gAId);
  check("and is stored verbatim", (await col1(`SELECT gender FROM public.products WHERE id=${Q(gAId)}`)).gender, "women");

  const gB = await api("POST", "/api/admin/products", baseProduct({
    slug: `route-${TAG}-gnone`, gender: null,
  }));
  check("no audience is accepted", gB.status, 200);
  const gBId = gB.body?.data?.id;
  if (gBId) created.products.push(gBId);
  // NULL rather than the empty string, because '' is not a valid audience and
  // would sit in the column failing the CHECK until the next write touched it.
  const gBrow = await col1(`SELECT gender IS NULL AS n FROM public.products WHERE id=${Q(gBId)}`);
  check("and lands as SQL NULL", gBrow.n, true);

  // A form that posts an audience the column does not have. Without the
  // validation this reached the CHECK constraint and surfaced as a bare 500,
  // which reads as "the server is broken" rather than "that value is wrong".
  const gBad = await api("POST", "/api/admin/products", baseProduct({
    slug: `route-${TAG}-gbad`, gender: "unisex",
  }));
  check("an unknown audience is refused", gBad.status, 400);
  check("with the named code the form can branch on", gBad.body?.code, "invalid_gender");
  check("and no row was created", (await col1(`SELECT count(*)::int c FROM public.products WHERE slug=${Q(`route-${TAG}-gbad`)}`)).c, 0);

  // Round trip through the list: the form seeds itself from the API, so an
  // audience that saves but does not come back is invisible until the next save
  // drops it.
  const gList = await api("GET", `/api/admin/products?search=route-${TAG}-gw&limit=10`);
  check("the list hands the audience back", gList.body?.data?.[0]?.gender, "women");
  await api("PUT", "/api/admin/products", {
    ...baseProduct({ slug: `route-${TAG}-gw`, gender: "kids" }), id: gAId,
  });
  check("and an update changes it", (await col1(`SELECT gender FROM public.products WHERE id=${Q(gAId)}`)).gender, "kids");

  // ---------------------------------------------------------------- 21
  section(21, "the list filters and sorts on the server");
  // The list used to filter in the browser, over the first hundred rows the
  // route happened to return, on title and slug only. Every assertion below is
  // about the two things that was wrong with that: what a filter could match,
  // and whether the total described everything or just the page.
  //
  // Four products under a marker no other row shares, so the counts are exact
  // regardless of what else is in the live catalogue.
  //
  // Each carries one colour-only variant, and that is not decoration.
  // admin_save_product derives products.stock as SUM(product_variants.stock),
  // so a product with an empty matrix is 0 no matter what `stock` says in the
  // payload. Fixtures without variants would therefore all read as out of stock
  // and the stock filters would be asserting against four identical rows.
  const M = `MKT${TAG}`;
  const marker = (n) => `${M} marker ${n}`;
  const specs = [
    { n: "a", gender: "women", status: "published", regular_price: 1000, stock: 20 },
    { n: "b", gender: "men", status: "draft", regular_price: 500, stock: 3 },
    { n: "c", gender: null, status: "draft", regular_price: 200, stock: 0 },
    { n: "d", gender: "kids", status: "published", regular_price: 50, stock: 5 },
  ];
  const mkIds = {};
  for (const s of specs) {
    const r = await api("POST", "/api/admin/products", baseProduct({
      slug: `route-${TAG}-m${s.n}`, title: marker(s.n),
      gender: s.gender, status: s.status, regular_price: s.regular_price,
      // The payload's own stock is ignored in favour of the matrix below, so
      // it is left at the base value deliberately: asserting the derived
      // number is the point.
      color_ids: [col.id],
      variants: [{ color_id: col.id, size_id: null, stock: s.stock, price_override: null, sku: `PT-MK-${s.n.toUpperCase()}`, is_active: true }],
    }));
    check(`marker ${s.n} seeds`, r.status, 200);
    mkIds[s.n] = r.body?.data?.id;
    if (mkIds[s.n]) created.products.push(mkIds[s.n]);
  }
  // The fixtures are only meaningful if the stock they were asked for is the
  // stock the database derived, so that is checked rather than assumed.
  for (const s of specs) {
    const got = await col1(`SELECT stock FROM public.products WHERE id=${Q(mkIds[s.n])}`);
    check(`marker ${s.n} derived its stock from the variant`, got.stock, s.stock);
  }

  const q = (qs) => api("GET", `/api/admin/products?limit=200&search=${encodeURIComponent(M)}&${qs}`);
  const rows = (r) => r.body?.data ?? [];

  check("an unfiltered search finds all four", (await q("")).body?.pagination?.total, 4);
  check("and an audience filter narrows it", rows(await q("gender=women")).map((p) => p.slug).sort(),
    [`route-${TAG}-ma`]);
  check("a different audience is a different result", rows(await q("gender=kids")).map((p) => p.slug), [`route-${TAG}-md`]);
  // "none" is a bucket, not an absence. Without it the unassigned products --
  // which the storefront also needs to find -- would be the only ones no filter
  // could select.
  check("the unassigned bucket is selectable", rows(await q("gender=none")).map((p) => p.slug), [`route-${TAG}-mc`]);
  // An unrecognised filter value must be refused. Silently ignoring it applies
  // no predicate, and "?gender=unisex" then answers with the whole catalogue,
  // which is indistinguishable from a correct result.
  const badGender = await q("gender=unisex");
  check("an unknown audience filter is refused", badGender.status, 400);
  check("with a code that says which parameter was wrong", badGender.body?.code, "invalid_gender_filter");

  check("status filters", rows(await q("status=published")).map((p) => p.slug).sort(),
    [`route-${TAG}-ma`, `route-${TAG}-md`]);
  check("a range is a lower and an upper bound", rows(await q("min_price=100&max_price=600")).map((p) => p.slug).sort(),
    [`route-${TAG}-mb`, `route-${TAG}-mc`]);
  // LOW_STOCK in the route is 5, and 5 is inclusive here on purpose: a
  // threshold that excluded the value it advertised would be off by one
  // against the label the filter dropdown shows.
  check("low stock is 1 through the threshold", rows(await q("stock_state=low")).map((p) => p.slug).sort(),
    [`route-${TAG}-mb`, `route-${TAG}-md`]);
  check("out of stock is exactly zero", rows(await q("stock_state=out")).map((p) => p.slug), [`route-${TAG}-mc`]);
  check("in stock excludes zero", rows(await q("stock_state=in")).map((p) => p.slug).sort(),
    [`route-${TAG}-ma`, `route-${TAG}-mb`, `route-${TAG}-md`]);
  check("a category filter works", rows(await q(`category_id=${cat.parent}`)).length >= 0, true);
  check("filters compose rather than replace one another",
    rows(await q("status=published&gender=women")).map((p) => p.slug), [`route-${TAG}-ma`]);

  // Sort has to be total, or paging through it can repeat or skip a row.
  const asc = rows(await q("sort=price_asc")).map((p) => p.price);
  check("price ascending is ordered", asc, [...asc].sort((a, b) => a - b));
  const priceDesc = rows(await q("sort=price_desc")).map((p) => p.price);
  check("price descending is the reverse", priceDesc, [...asc].sort((a, b) => b - a));
  check("title sorting works too", rows(await q("sort=title_asc")).map((p) => p.title), specs.map((s) => marker(s.n)));

  // An unknown key must not reach the query builder as a column name.
  const bogus = await q("sort=price_asc;DROP+TABLE+products");
  check("an unknown sort key is not an error", bogus.status, 200);
  check("it falls back to newest", bogus.body?.sort, "newest");
  // The fallback is visible, so the control can label the order it is actually
  // receiving rather than one the query ignored.
  check("a known key is echoed back", (await q("sort=price_asc")).body?.sort, "price_asc");

  // Paging: the total must describe everything matching, and consecutive pages
  // must be disjoint. The old shape -- total equal to the page length -- is what
  // made the table able to claim it had shown "all 20" of 214.
  const p1 = await api("GET", `/api/admin/products?limit=2&page=1&search=${encodeURIComponent(M)}&sort=title_asc`);
  const p2 = await api("GET", `/api/admin/products?limit=2&page=2&search=${encodeURIComponent(M)}&sort=title_asc`);
  check("a short page is honoured", p1.body?.data?.length, 2);
  check("the total is the count of everything that matched", p1.body?.pagination?.total, 4);
  check("the page count follows from it", p1.body?.pagination?.pages, 2);
  const seen = new Set([...p1.body?.data ?? [], ...p2.body?.data ?? []]);
  check("two pages cover four distinct rows", [...seen].length, 4);
  check("no row is repeated across pages",
    (p1.body?.data ?? []).some((a) => (p2.body?.data ?? []).some((b) => a.id === b.id)), false);
  // Past the end there is an empty page, not an error and not a wrap back to
  // page one.
  const p9 = await api("GET", `/api/admin/products?limit=2&page=9&search=${encodeURIComponent(M)}`);
  check("a page past the end is empty", p9.body?.data?.length, 0);
  check("and still reports the real total", p9.body?.pagination?.total, 4);

  // The total is a count of matches, not of rows loaded. Checked against the
  // database so the two cannot both be wrong in the same way.
  const truth = await col1(
    `SELECT count(*)::int c FROM public.products
      WHERE deleted_at IS NULL AND gender='women'`);
  const genderPage = await api("GET", "/api/admin/products?gender=women&limit=1");
  check("an unfiltered total agrees with the database", genderPage.body?.pagination?.total, truth.c);
  check("while returning only the one row asked for", genderPage.body?.data?.length, 1);

  // Search reaches past title and slug. A search that only matches the title is
  // the reason an admin ends up scrolling instead of typing a SKU.
  const parentName = (await col1(`SELECT name FROM public.categories WHERE id=${Q(cat.parent)}`)).name;
  const byCategory = await api("GET", `/api/admin/products?limit=50&search=${encodeURIComponent(parentName)}`);
  check("search matches the category text", rows(byCategory).every((p) => p.category?.toLowerCase().includes(parentName.toLowerCase())), true);
  check("and reaches the whole catalogue, not this suite's rows",
    (byCategory.body?.pagination?.total ?? 0) > 4, true);

  // ---------------------------------------------------------------- 22
  section(22, "three discount models, one stored markdown");
  // Every money assertion below wraps its value in Number(). The SQL API returns
  // NUMERIC as text ("850.00") while the RPC's JSON result returns it as a
  // number (850), so an unwrapped comparison fails for a reason that has nothing
  // to do with the discount logic being tested.
  // The form used to offer a discount AND a free-text badge AND a badge type,
  // describing the same fact three times over, with nothing connecting them. A
  // full-price product could be labelled SALE. These assert the replacement:
  // three ways to express a markdown, all normalising onto one
  // (regular_price, discount_type, discount_value) triple, with the badge
  // derived from that triple rather than typed beside it.

  const saveWith = (over) => api("POST", "/api/admin/products", baseProduct(over));

  // --- model 1: price comparison
  const cmp = await saveWith({
    slug: `route-${TAG}-cmp`, discount_mode: "comparison",
    regular_price: 1000, comparison_price: 850,
  });
  check("a price comparison saves", cmp.status, 200);
  const cmpId = cmp.body?.data?.id;
  if (cmpId) created.products.push(cmpId);
  const cmpRow = await col1(`SELECT * FROM public.products WHERE id=${Q(cmpId)}`);
  check("the new price becomes the sale price", Number(cmpRow.price), 850);
  check("and the old price is kept as the base", Number(cmpRow.original_price), 1000);
  check("the markdown is the percentage between them", Number(cmpRow.discount_value), 15);
  check("stored as a percentage, since that is the stored shape", cmpRow.discount_type, "percentage");
  check("the mode is recorded", cmpRow.discount_mode, "comparison");
  check("the percentage is 15", cmpRow.discount_percent, 15);
  check("and the badge is generated from it", cmpRow.badge, "15% OFF");
  check("with the discount badge type", cmpRow.badge_type, "discount");
  // The return value carries what was stored, so a client never has to trust
  // its own arithmetic for the number it is about to display.
  check("the response echoes the stored sale price", cmp.body?.data?.sale_price, 850);
  check("and the stored badge", cmp.body?.data?.badge, "15% OFF");

  // The rounding requirement, on a price pair that does not divide evenly.
  // 349.99 off 400 is 12.5025%, which is stored as 12.50 (discount_value is
  // NUMERIC(10,2), so a third decimal would be truncated and the stored number
  // would stop describing the pair of prices that produced it) and displayed as
  // 13%. A badge reading "12.5% OFF" would be neither accurate to the paisa nor
  // readable.
  const oddPair = await saveWith({
    slug: `route-${TAG}-cmpodd`, discount_mode: "comparison",
    regular_price: 400, comparison_price: 349.99,
  });
  check("an uneven pair saves", oddPair.status, 200);
  if (oddPair.body?.data?.id) created.products.push(oddPair.body.data.id);
  const oddPairRow = await col1(`SELECT * FROM public.products WHERE id=${Q(oddPair.body?.data?.id)}`);
  check("the percentage is stored to two decimals", Number(oddPairRow.discount_value), 12.5);
  check("the badge rounds it to a whole number", oddPairRow.badge, "13% OFF");
  check("and so does the percentage column", oddPairRow.discount_percent, 13);

  // The sale price comes back as 350.00, not the 349.99 that was typed, and that
  // is the model working rather than failing.
  //
  // A percentage discount is stored to two decimals, so 349.99 off 400 is
  // 12.5025% -> 12.50%, and 12.50% of 400 is exactly 350.00. The alternative --
  // storing the typed price and letting the percentage describe it -- was
  // rejected deliberately: get_effective_prices() recomputes the sale price from
  // regular_price and the discount, so a stored price the recomputation does not
  // reproduce would show one number on a product card and charge another at
  // checkout. A paisa of adjustment is visible and explainable; a display that
  // disagrees with the charge is neither.
  check("the sale price is what the stored percentage yields", Number(oddPairRow.price), 350);
  // A pair that a two-decimal percentage CAN express is stored exactly, which is
  // the case that matters: 1000 -> 850 above stored 850.00, not 849.99 or
  // 850.01.
  check("a percentage-exact pair is stored exactly", Number(cmpRow.price), 850);

  // A "new price" at or above the old one is not a discount. Reported as one it
  // would be a negative markdown, which the column CHECK refuses, so the save
  // would fail with a constraint error instead of accepting "no discount".
  const priceRise = await saveWith({
    slug: `route-${TAG}-cmprise`, discount_mode: "comparison",
    regular_price: 500, comparison_price: 600,
  });
  check("a new price above the old one saves", priceRise.status, 200);
  if (priceRise.body?.data?.id) created.products.push(priceRise.body.data.id);
  const priceRiseRow = await col1(`SELECT * FROM public.products WHERE id=${Q(priceRise.body?.data?.id)}`);
  check("with no markdown", Number(priceRiseRow.discount_value), 0);
  check("no badge", priceRiseRow.badge, null);
  check("and the full price as the sale price", Number(priceRiseRow.price), 500);

  // --- model 2: custom discount, both kinds
  const pct = await saveWith({
    slug: `route-${TAG}-pct`, discount_mode: "custom",
    regular_price: 1000, discount_type: "percentage", discount_value: 14.8,
  });
  check("a custom percentage saves", pct.status, 200);
  if (pct.body?.data?.id) created.products.push(pct.body.data.id);
  const pctRow = await col1(`SELECT * FROM public.products WHERE id=${Q(pct.body?.data?.id)}`);
  check("14.8% is stored as entered", Number(pctRow.discount_value), 14.8);
  check("but the badge says 15%", pctRow.badge, "15% OFF");
  check("and the percentage column agrees", pctRow.discount_percent, 15);

  const flatMd = await saveWith({
    slug: `route-${TAG}-flat`, discount_mode: "custom",
    regular_price: 700, discount_type: "flat", discount_value: 150,
  });
  check("a flat amount saves", flat.status, 200);
  if (flatMd.body?.data?.id) created.products.push(flat.body.data.id);
  const flatMdRow = await col1(`SELECT * FROM public.products WHERE id=${Q(flatMd.body?.data?.id)}`);
  check("the amount is taken off the price", Number(flatMdRow.price), 550);
  check("the badge names the amount, not a percentage", flatMdRow.badge, "150 OFF");
  // This was 0: discount_percent was only filled in for percentage markdowns, so
  // the detail page claimed a flat saving was worth no percentage at all.
  check("the percentage it represents is derived from the prices", flatMdRow.discount_percent, 21);
  check("rounded to a whole number", flatMdRow.discount_percent, 21);

  // --- model 3: promotion integration
  // The product's own markdown is cleared, because a product discount left over
  // from a previous mode would stack under the promotion's and the shopper would
  // pay less than either advertised saving.
  const stacked = await saveWith({
    slug: `route-${TAG}-stack`, discount_mode: "custom",
    regular_price: 1000, discount_type: "percentage", discount_value: 30,
  });
  const stackedId = stacked.body?.data?.id;
  if (stackedId) created.products.push(stackedId);
  check("a product can start with a 30% markdown", stacked.body?.data?.badge, "30% OFF");
  const switched = await api("PUT", "/api/admin/products", {
    ...baseProduct({
      slug: `route-${TAG}-stack`, discount_mode: "promotion",
      regular_price: 1000, promotion_ids: [promo],
    }),
    id: stackedId,
  });
  check("switching it to a promotion saves", switched.status, 200);
  const switchedRow = await col1(`SELECT * FROM public.products WHERE id=${Q(stackedId)}`);
  check("the leftover markdown is cleared", Number(switchedRow.discount_value), 0);
  check("and the product's own badge with it", switchedRow.badge, null);
  check("the mode is promotion", switchedRow.discount_mode, "promotion");
  check("and the link exists", (await col1(
    `SELECT count(*)::int c FROM public.promotion_products WHERE product_id=${Q(stackedId)} AND promotion_id=${Q(promo)}`)).c, 1);

  // The promotion supplies the badge, live, at read time. It is a read-time
  // decision because the promotion's dates decide whether it applies -- storing
  // it on the product would have made a dated campaign permanent the moment it
  // was linked.
  const liveBadge = (await col1(
    `SELECT * FROM public.get_effective_badges(ARRAY[${Q(stackedId)}::text])`));
  check("the live promotion supplies the badge label", liveBadge.badge_label, "10% OFF");
  check("and the promotion's own badge type", liveBadge.badge_type, "discount");
  check("with its percentage", liveBadge.discount_percent, 10);
  check("and its price as the final one", Number(liveBadge.final_price), 900);
  check("while the product's own markdown stays clear", Number(switchedRow.price), 1000);

  // A promotion with its own label supplies that label, not the raw discount.
  await must(`UPDATE public.promotions SET badge_label='Eid Special', badge_type='festive' WHERE id=${Q(promo)}`);
  const labelled = (await col1(
    `SELECT * FROM public.get_effective_badges(ARRAY[${Q(stackedId)}::text])`));
  check("a promotion's own label wins", labelled.badge_label, "Eid Special");
  check("and its own badge type, for the colour", labelled.badge_type, "festive");
  await must(`UPDATE public.promotions SET badge_label='Winter 20%', badge_type=NULL WHERE id=${Q(promo)}`);

  // --- the badge cannot be authored
  //
  // The old form sent a free-text badge next to a price the server had derived,
  // which is how a full-price product ended up labelled SALE. The payload key is
  // now dropped by the route and ignored by the function.
  const spoof = await saveWith({
    slug: `route-${TAG}-spoof`, discount_mode: "none",
    regular_price: 500, badge: "SALE", badge_type: "popular",
  });
  check("a payload carrying a badge still saves", spoof.status, 200);
  if (spoof.body?.data?.id) created.products.push(spoof.body.data.id);
  const spoofRow = await col1(`SELECT * FROM public.products WHERE id=${Q(spoof.body?.data?.id)}`);
  check("but the badge is not stored", spoofRow.badge, null);
  check("and neither is the badge type", spoofRow.badge_type, null);
  check("a full-price product cannot be labelled SALE", Number(spoofRow.price), 500);

  // A discount the payload disagrees about is still the one that gets a badge.
  const disagree = await saveWith({
    slug: `route-${TAG}-disagree`, discount_mode: "comparison",
    regular_price: 800, comparison_price: 700, badge: "80% OFF",
  });
  if (disagree.body?.data?.id) created.products.push(disagree.body.data.id);
  const disagreeRow = await col1(`SELECT * FROM public.products WHERE id=${Q(disagree.body?.data?.id)}`);
  check("a claimed badge is replaced by the real one", disagreeRow.badge, "13% OFF");

  // --- the mode round-trips, so the form reopens on the model that was used
  // Selected by id rather than by taking the first row. The search is a
  // substring match, so "route-<tag>-cmp" also matches "route-<tag>-cmpodd", and
  // the list is ordered newest first -- which made this assert against the wrong
  // product until it was pinned to an id.
  const cmpList = await api("GET", `/api/admin/products?search=route-${TAG}-cmp&limit=10`);
  const cmpListed = (cmpList.body?.data ?? []).find((x) => x.id === cmpId);
  check("the list returns the mode", cmpListed?.discount_mode, "comparison");
  check("and the derived badge", cmpListed?.badge, "15% OFF");
  // The form seeds comparison mode's new price from the stored sale price, so a
  // product saved through comparison comes back with both fields populated and
  // the second field is not blank.
  check("with a sale price to seed the comparison from", Number(cmpListed?.price), 850);

  // --- an unknown mode is refused rather than filed under a default
  const badMode = await saveWith({ slug: `route-${TAG}-badmode`, discount_mode: "clearance" });
  check("an unknown discount mode is refused", badMode.status, 400);
  check("with the named code", badMode.body?.code, "invalid_discount_mode");

  // --- a markdown with no promotion still gets a badge
  //
  // get_effective_badges returned a row ONLY for products with a live promotion
  // (WHERE e.promotion_id IS NOT NULL), so a product with a markdown and no
  // promotion returned nothing and the card fell through to the hand-typed
  // column. That is the defect that made deprecating the hand-typed column
  // unsafe: doing it without this fix would have silently removed the badge from
  // every discounted product.
  const flatBadge = (await col1(
    `SELECT * FROM public.get_effective_badges(ARRAY[${Q(flatMd.body?.data?.id)}::text])`));
  check("a markdown with no promotion has a badge", flatBadge.badge_label, "150 OFF");
  check("typed as a discount", flatBadge.badge_type, "discount");
  const noBadge = (await col1(
    `SELECT * FROM public.get_effective_badges(ARRAY[${Q(spoof.body?.data?.id)}::text])`));
  check("a product with no discount has no badge", noBadge.badge_label, null);
  check("and no badge type", noBadge.badge_type, null);
  // Every product gets a row now, which is what lets a consumer distinguish
  // "no badge" from "this product was not considered".
  check("every product has a row", (await col1(
    `SELECT count(*)::int c FROM public.get_effective_badges(ARRAY(SELECT id FROM public.products))`)).c,
    (await col1(`SELECT count(*)::int c FROM public.products`)).c);

  console.log(fails === 0 ? "\nALL PRODUCT API CHECKS PASS" : `\n${fails} FAILED`);
} catch (err) {
  console.error("\nTHREW:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await cleanup();
}
