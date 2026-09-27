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

  console.log(fails === 0 ? "\nALL PRODUCT API CHECKS PASS" : `\n${fails} FAILED`);
} catch (err) {
  console.error("\nTHREW:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await cleanup();
}
