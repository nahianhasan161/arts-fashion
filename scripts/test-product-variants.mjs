/**
 * SQL checks for the variant authoring and categorisation work.
 *
 * These matter more than the HTTP ones, because the storefront's ability to
 * sell a product depends entirely on what this layer guarantees: that a
 * colour/size pair resolves to exactly one stock row, that a product cannot
 * be saved half-linked, and that the two representations of the taxonomy
 * cannot disagree.
 *
 *   node scripts/test-product-variants.mjs
 */

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF ?? "khebwqdhucrdfpfadxry";
const Q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const J = (o) => Q(JSON.stringify(o)) + "::jsonb";

async function rawOnce(sql) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  let r;
  try {
    r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
      signal: ctrl.signal,
    });
  } catch (e) {
    return { err: "TIMEOUT: " + e.message };
  } finally {
    clearTimeout(timer);
  }
  const t = await r.text();
  if (r.status >= 400) return { err: t };
  return t ? JSON.parse(t) : null;
}

async function raw(sql) {
  for (let a = 0; a < 4; a++) {
    const r = await rawOnce(sql);
    if (!r.err || !/JWT could not be decoded/.test(r.err)) return r;
    await new Promise((res) => setTimeout(res, 400 * (a + 1)));
  }
  return rawOnce(sql);
}
const must = async (sql) => {
  const r = await raw(sql);
  if (r.err) {
    console.error("FAILED SQL: " + sql.slice(0, 300) + "\nERR: " + r.err.slice(0, 400));
    process.exit(1);
  }
  return r;
};

let fails = 0;
const check = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) fails++;
  console.log(
    `${pass ? "PASS  " : "FAIL  "}${label.padEnd(56)} got=${JSON.stringify(actual)}${pass ? "" : " want=" + JSON.stringify(expected)}`
  );
};
const raiseOf = (r) =>
  r.err ? (r.err.match(/ERROR:\s+(?:[0-9A-Z]{5}:\s+)?([a-z_]+)/) || [, "unknown"])[1] : null;

const ADM = "00000000-0000-4000-8000-0000000000ee";
const PWD = "vt-" + Math.random().toString(36).slice(2) + "-Aa1!";
const asAdmin = (expr) =>
  raw(
    `WITH ctx AS (SELECT set_config('request.jwt.claims', ${Q(
      JSON.stringify({ sub: ADM, role: "authenticated" })
    )}, true) s) SELECT ${expr} FROM ctx`
  );
const one = (r) => r?.[0] ?? null;

// ---- fixtures ---------------------------------------------------------
// products.id is a generated uuid, so an "id LIKE 'vt-%'" filter matches
// nothing. Everything here is identified by slug, which the test controls.
const SLUG = "vt-" + Math.random().toString(36).slice(2, 8);

/**
 * The products this suite builds are all titled "VT Test Shirt", so their
 * slugs all begin with a fixed prefix even though the run's own tag is random.
 * Sweeping that prefix at both ends is what removes the residue of an earlier
 * run that threw partway through: cleanup by this run's tag cannot see it,
 * because the tag belonged to a different invocation.
 *
 * Only the fixed prefix is matched, never a bare "%", so a real product can
 * never be caught by it.
 */
const sweepResidue = () =>
  must(`DELETE FROM public.products WHERE slug LIKE 'vt-test-shirt%'`);

const likeSlug = `%${SLUG}%`;
await sweepResidue();
await must(`DELETE FROM public.product_images WHERE product_id IN (SELECT id FROM public.products WHERE slug LIKE ${Q(likeSlug)})`);
await must(`DELETE FROM public.promotion_products WHERE product_id IN (SELECT id FROM public.products WHERE slug LIKE ${Q(likeSlug)})`);
await must(`DELETE FROM public.product_variants WHERE product_id IN (SELECT id FROM public.products WHERE slug LIKE ${Q(likeSlug)})`);
await must(`DELETE FROM public.product_colors WHERE product_id IN (SELECT id FROM public.products WHERE slug LIKE ${Q(likeSlug)})`);
await must(`DELETE FROM public.product_sizes WHERE product_id IN (SELECT id FROM public.products WHERE slug LIKE ${Q(likeSlug)})`);
await must(`DELETE FROM public.products WHERE slug LIKE ${Q(likeSlug)}`);
await must(`DELETE FROM public.profiles WHERE id=${Q(ADM)}`);
await must(`DELETE FROM auth.users WHERE id=${Q(ADM)}`);

await must(`
  INSERT INTO auth.users (id,email,encrypted_password,email_confirmed_at,raw_app_meta_data,
    raw_user_meta_data,aud,role,instance_id,created_at,updated_at,
    confirmation_token,recovery_token,email_change_token_new,email_change)
  VALUES (${Q(ADM)},'variant-sql@test.local',extensions.crypt(${Q(PWD)},extensions.gen_salt('bf',10)),now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,
    'authenticated','authenticated','00000000-0000-0000-0000-000000000000',now(),now(),'','','','')`);
await must(`
  INSERT INTO auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
  VALUES (gen_random_uuid(),${Q(ADM)},${Q(ADM)},
    ${J({ sub: ADM, email: "variant-sql@test.local", email_verified: true })},'email',now(),now(),now())
  ON CONFLICT DO NOTHING`);
await must(
  `INSERT INTO public.profiles (id,email,full_name,role) VALUES (${Q(ADM)},'variant-sql@test.local','VT','admin')
   ON CONFLICT (id) DO UPDATE SET role='admin'`
);

// Two top-level categories with one child each, so the parent/child rules
// have something real to be right or wrong about.
const mkCat = async (name, parent) => {
  const r = await must(
    `INSERT INTO public.categories (name, slug, parent_id) VALUES (${Q(name)}, ${Q("vt-" + name)}, ${parent ? Q(parent) : "NULL"})
     ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, parent_id=EXCLUDED.parent_id
     RETURNING id`
  );
  return r[0].id;
};
const CAT_A = await mkCat("vt-top-a", null);
const CAT_B = await mkCat("vt-top-b", null);
const SUB_A1 = await mkCat("vt-sub-a1", CAT_A);
const SUB_A2 = await mkCat("vt-sub-a2", CAT_A);
const SUB_B1 = await mkCat("vt-sub-b1", CAT_B);

const rows = (q) => must(q);
const col1 = async (q) => (await rows(q))[0];
const count = async (q) => (await col1(q)).c;

// Two colours, three sizes, for a 2x3 matrix.
const colIds = (await rows(
  `SELECT id FROM public.colors WHERE is_active ORDER BY name LIMIT 2`
)).map((r) => r.id);
const sizeIds = (await rows(
  `SELECT id FROM public.sizes WHERE is_active AND type='clothing' ORDER BY display_order LIMIT 3`
)).map((r) => r.id);
const promoId = (await col1(`SELECT id FROM public.promotions ORDER BY created_at LIMIT 1`))?.id ?? null;

// The guarded wrapper is the only function `authenticated` can execute: the
// 20260927110000 migration revoked the grant on admin_save_product itself so
// the price check cannot be bypassed. The tests impersonate an authenticated
// admin, so they must go through the same door the route does.
const save = (payload) => asAdmin(`public.admin_save_product_guarded(${J(payload)})`);

/** Saves and THROWS on failure, so a broken happy path cannot be mistaken
 *  for a missing field in the result. The error-raising tests use save(). */
const saveRes = async (payload) => {
  // await is load-bearing: without it `r` is a Promise, and every r.err and
  // one(r) check below quietly reads undefined instead of failing loudly.
  const r = await save(payload);
  if (r.err) {
    throw new Error("admin_save_product refused: " + r.err.slice(0, 700));
  }
  if (!one(r)) throw new Error("admin_save_product_guarded returned no row: " + JSON.stringify(r));
  return one(r).admin_save_product_guarded;
};

const base = {
  title: "VT Test Shirt",
  slug: `${SLUG}-shirt`,
  category_id: CAT_A,
  sub_category_id: SUB_A1,
  regular_price: 2000,
  discount_type: "percentage",
  discount_value: 10,
  description: "<p>Rich <b>text</b></p>",
  specs: { Fabric: "Cotton" },
  color_ids: [],
  size_ids: [],
  variants: [],
  promotion_ids: [],
};

try {
  // ---- 1. creation and categorisation ------------------------------
  console.log("\n=== 1. a product saves with its category linked ===");
  const created = await saveRes(base);
  check("create returns an id", typeof created?.id, "string");
  const PID = created.id;

  const p1 = await col1(`SELECT * FROM public.products WHERE id=${Q(PID)}`);
  check("category_id is stored", p1.category_id, CAT_A);
  check("sub_category_id is stored", p1.sub_category_id, SUB_A1);
  check("the category NAME is derived", p1.category, "vt-top-a");
  check("the sub-category NAME is derived", p1.sub_category, "vt-sub-a1");
  check("sale price is derived", Number(p1.price), 1800);
  check("original_price mirrors regular", Number(p1.original_price), 2000);
  check("regular_price is kept", Number(p1.regular_price), 2000);
  check("discount percent is derived", p1.discount_percent, 10);
  check("status defaults to draft", p1.status, "draft");
  check("rich text is preserved verbatim", p1.description, "<p>Rich <b>text</b></p>");

  console.log("\n=== 2. the name columns cannot drift from the ids ===");
  await must(
    `UPDATE public.products SET category_id=${Q(CAT_B)}, sub_category_id=${Q(SUB_B1)} WHERE id=${Q(PID)}`
  );
  const p2 = await col1(`SELECT * FROM public.products WHERE id=${Q(PID)}`);
  check("renaming the category follows the id", p2.category, "vt-top-b");
  check("renaming the sub-category follows", p2.sub_category, "vt-sub-b1");

  // The important one: sending only a parent must clear a stale child.
  await must(`UPDATE public.products SET sub_category_id=NULL, category_id=${Q(CAT_A)} WHERE id=${Q(PID)}`);
  const p3 = await col1(`SELECT * FROM public.products WHERE id=${Q(PID)}`);
  check("a stale sub-category is cleared with its parent", p3.sub_category, null);
  check("the parent name is applied", p3.category, "vt-top-a");

  // A sub-category alone must imply its parent, or the pair disagrees again.
  await must(
    `UPDATE public.products SET category_id=NULL, sub_category_id=${Q(SUB_A2)} WHERE id=${Q(PID)}`
  );
  const p4 = await col1(`SELECT * FROM public.products WHERE id=${Q(PID)}`);
  check("a sub-category alone implies its parent", p4.category_id, CAT_A);
  check("and the parent name is filled in", p4.category, "vt-top-a");
  check("the sub-category name is correct", p4.sub_category, "vt-sub-a2");

  // Put it back for the variant tests.
  await must(
    `UPDATE public.products SET category_id=${Q(CAT_A)}, sub_category_id=${Q(SUB_A1)} WHERE id=${Q(PID)}`
  );

  console.log("\n=== 3. validation refuses inconsistent input ===");
  // Every case below is an UPDATE of PID, not a create. Sending them as
  // creates would reuse base's slug, so the slug check would refuse first
  // and the field actually under test would never be reached.
  const bad = async (patch) => raiseOf(await save({ ...base, id: PID, ...patch }));

  check("a missing title is refused", await bad({ title: "  " }), "title_required");
  check("a missing category is refused", await bad({ category_id: "" }), "category_required");
  check("an unknown category is refused", await bad({ category_id: "nope" }), "category_not_found");
  check(
    "a sub-category of another parent is refused",
    await bad({ category_id: CAT_A, sub_category_id: SUB_B1 }),
    "subcategory_not_found"
  );
  check("a negative price is refused", await bad({ regular_price: -5 }), "invalid_regular_price");
  check(
    "a discount over 100% is refused",
    await bad({ discount_type: "percentage", discount_value: 150 }),
    "invalid_percentage_discount"
  );
  check(
    "a flat discount larger than the price is refused",
    await bad({ discount_type: "flat", regular_price: 100, discount_value: 200 }),
    "invalid_flat_discount"
  );
  check("an unknown discount type is refused", await bad({ discount_type: "bOGUS" }), "invalid_discount_type");
  check("an unknown status is refused", await bad({ status: "weird" }), "invalid_status");
  check(
    "an unknown colour is refused, not dropped",
    await bad({ color_ids: ["nope"] }),
    "unknown_color"
  );
  check(
    "a colour list of only unknown ids is still refused",
    await bad({ color_ids: ["nope", "also-nope"] }),
    "unknown_color"
  );
  check("an unknown size is refused, not dropped", await bad({ size_ids: ["nope"] }), "unknown_size");
  check("an unknown id on update is refused", raiseOf(await save({ ...base, id: "nope" })), "product_not_found");
  check("a non-array variants payload is refused", await bad({ variants: "nope" }), "invalid_variants");
  check("an unknown promotion is refused", await bad({ promotion_ids: ["nope"] }), "unknown_promotion");

  // A refused save must leave the row exactly as it was.
  const untouched = await col1(`SELECT title, regular_price, category_id FROM public.products WHERE id=${Q(PID)}`);
  check("a refused save changes nothing (title)", untouched.title, "VT Test Shirt");
  check("a refused save changes nothing (price)", Number(untouched.regular_price), 2000);
  check("a refused save changes nothing (category)", untouched.category_id, CAT_A);

  // An empty option list is legitimate and must not trip the unknown-id guard.
  check("an empty option list is accepted", (await saveRes({ ...base, id: PID }))?.id, PID);

  // A derived slug is made unique; an explicit one is refused when taken.
  // Asserted as properties rather than exact strings, because the exact
  // suffix depends on whether any other product already holds the base slug,
  // which is exactly the thing being tested.
  const regen = await saveRes({ ...base, id: PID, slug: "" });
  check("a derived slug comes from the title", /^vt-test-shirt(-\d+)?$/.test(regen.slug), true);
  const twin = await saveRes({ ...base, id: "", title: "VT Test Shirt", slug: "" });
  check("the twin's slug is the same base", /^vt-test-shirt(-\d+)?$/.test(twin.slug), true);
  check("the two derived slugs differ", regen.slug !== twin.slug, true);
  check("the product's own slug is still free to re-submit",
    (await saveRes({ ...base, id: PID, slug: regen.slug }))?.slug, regen.slug);
  check(
    "an explicitly taken slug is refused",
    raiseOf(await save({ ...base, id: "", title: "Other", slug: twin.slug })),
    "slug_taken"
  );

  // Deleted by id, not by slug pattern: the twin's slug was DERIVED from the
  // title, so it does not carry this run's slug prefix and a LIKE on the
  // prefix would leave it in place.
  await must(`DELETE FROM public.product_variants WHERE product_id=${Q(twin.id)}`);
  await must(`DELETE FROM public.products WHERE id=${Q(twin.id)}`);

  // Once the twin is gone its slug is free again, which is what makes a
  // "slug taken" refusal recoverable rather than a permanent dead end.
  const reclaimed = await saveRes({ ...base, id: "", title: "Third", slug: twin.slug });
  check("a freed slug can be taken again", reclaimed.slug, twin.slug);
  await must(`DELETE FROM public.products WHERE id=${Q(reclaimed.id)}`);

  // Back to the run's own slug for the rest of the suite.
  await must(`UPDATE public.products SET slug=${Q(base.slug)} WHERE id=${Q(PID)}`);

  console.log("\n=== 4. the variant matrix ===");
  check("no options means no variants", await count(
    `SELECT count(*)::int c FROM public.product_variants WHERE product_id=${Q(PID)}`), 0);

  const matrix = await saveRes({
    ...base,
    id: PID,
    color_ids: colIds,
    size_ids: sizeIds,
    variants: colIds.flatMap((c) =>
      sizeIds.map((s, i) => ({ color_id: c, size_id: s, stock: 2 + i, is_active: true }))
    ),
  });
  check("2 colours x 3 sizes is 6 variants", matrix.variant_count, 6);
  check("stock sums to 6 + 7 + 8 per colour", matrix.stock, 2 * (2 + 3 + 4));
  check("every pair exists", await count(
    `SELECT count(*)::int c FROM public.product_variants
      WHERE product_id=${Q(PID)} AND color_id IS NOT NULL AND size_id IS NOT NULL`), 6);
  check("variant_key is always populated", await count(
    `SELECT count(*)::int c FROM public.product_variants
      WHERE product_id=${Q(PID)} AND (variant_key IS NULL OR variant_key='')`,), 0);
  check("products.stock follows the matrix", (await col1(
    `SELECT stock FROM public.products WHERE id=${Q(PID)}`)).stock, matrix.stock);

  console.log("\n=== 5. a colour/size pair resolves to exactly one variant ===");
  // This is the property checkout depends on. resolve_order_variant() refuses
  // an ambiguous match, so a missing or duplicated cell is an unsellable
  // product rather than a cosmetic bug.
  for (const c of colIds) {
    for (const s of sizeIds) {
      const cName = (await col1(`SELECT name FROM public.colors WHERE id=${Q(c)}`)).name;
      const sName = (await col1(`SELECT display_name FROM public.sizes WHERE id=${Q(s)}`)).display_name;
      const r = await asAdmin(
        `public.resolve_order_variant(${Q(PID)}, ${Q(sName)}, ${Q(cName)})`
      );
      const got = one(r)?.resolve_order_variant;
      const want = (await col1(
        `SELECT id FROM public.product_variants
          WHERE product_id=${Q(PID)} AND color_id=${Q(c)} AND size_id=${Q(s)}`
      )).id;
      check(`"${cName} / ${sName}" resolves`, got, want);
    }
  }
  // A pair that was never offered must refuse rather than guess.
  const bogus = await asAdmin(
    `public.resolve_order_variant(${Q(PID)}, 'NOT-A-SIZE', ${Q(
      (await col1(`SELECT name FROM public.colors WHERE id=${Q(colIds[0])}`)).name)})`
  );
  check("an unoffered size refuses", one(bogus)?.resolve_order_variant, null);

  console.log("\n=== 6. the matrix survives editing ===");
  const variantIdsBefore = (await rows(
    `SELECT id FROM public.product_variants WHERE product_id=${Q(PID)} ORDER BY color_id, size_id`
  )).map((r) => r.id);

  // Re-saving the same matrix must not churn row identities, because a
  // surviving row keeps its product_stock allocation.
  await saveRes({ ...base, id: PID, color_ids: colIds, size_ids: sizeIds, variants: [] });
  const afterResave = (await rows(
    `SELECT id FROM public.product_variants WHERE product_id=${Q(PID)} ORDER BY color_id, size_id`
  )).map((r) => r.id);
  check("re-saving keeps every row id", afterResave.join(), variantIdsBefore.join());
  check("and resets stock to the default 0", await count(
    `SELECT count(*)::int c FROM public.product_variants WHERE product_id=${Q(PID)} AND stock<>0`), 0);

  // Removing one colour must remove exactly its rows and keep the rest.
  await saveRes({
    ...base,
    id: PID,
    color_ids: [colIds[0]],
    size_ids: sizeIds,
    variants: sizeIds.map((s, i) => ({ color_id: colIds[0], size_id: s, stock: i + 1 })),
  });
  check("dropping a colour drops its 3 rows", await count(
    `SELECT count(*)::int c FROM public.product_variants WHERE product_id=${Q(PID)}`), 3);
  check("the surviving rows are the kept colour's", await count(
    `SELECT count(*)::int c FROM public.product_variants
      WHERE product_id=${Q(PID)} AND color_id=${Q(colIds[0])}`), 3);

  // Adding a colour back adds rows without disturbing the survivors.
  const keptIds = (await rows(
    `SELECT id FROM public.product_variants WHERE product_id=${Q(PID)} ORDER BY size_id`
  )).map((r) => r.id);
  await saveRes({
    ...base,
    id: PID,
    color_ids: colIds,
    size_ids: sizeIds,
    variants: [
      ...sizeIds.map((s, i) => ({ color_id: colIds[0], size_id: s, stock: 9 })),
      ...sizeIds.map((s) => ({ color_id: colIds[1], size_id: s, stock: 1 })),
    ],
  });
  const keptAfter = (await rows(
    `SELECT id FROM public.product_variants WHERE product_id=${Q(PID)} AND color_id=${Q(colIds[0])} ORDER BY size_id`
  )).map((r) => r.id);
  check("re-adding a colour keeps the other rows' ids", keptAfter.join(), keptIds.join());
  check("the matrix is 6 rows again", await count(
    `SELECT count(*)::int c FROM public.product_variants WHERE product_id=${Q(PID)}`), 6);
  check("stock was updated", await count(
    `SELECT count(*)::int c FROM public.product_variants WHERE product_id=${Q(PID)} AND stock=9`), 3);

  console.log("\n=== 7. single-axis products ===");
  const P_SIZES = await saveRes({ ...base, id: "", title: "VT Sizes Only", slug: `${SLUG}-sizes-only`, size_ids: sizeIds });
  check("sizes only is one row per size", P_SIZES.variant_count, sizeIds.length);
  check("each row has no colour", await count(
    `SELECT count(*)::int c FROM public.product_variants WHERE product_id=${Q(P_SIZES.id)} AND color_id IS NULL`), sizeIds.length);

  const P_COLORS = await saveRes({ ...base, id: "", title: "VT Colors Only", slug: `${SLUG}-colors-only`, color_ids: colIds });
  check("colours only is one row per colour", P_COLORS.variant_count, colIds.length);
  check("each row has no size", await count(
    `SELECT count(*)::int c FROM public.product_variants WHERE product_id=${Q(P_COLORS.id)} AND size_id IS NULL`), colIds.length);

  const sName0 = (await col1(`SELECT display_name FROM public.sizes WHERE id=${Q(sizeIds[0])}`)).display_name;
  const sOnly = await asAdmin(`public.resolve_order_variant(${Q(P_SIZES.id)}, ${Q(sName0)}, '')`);
  check("a size-only product resolves by size", typeof one(sOnly)?.resolve_order_variant, "string");
  const cName0 = (await col1(`SELECT name FROM public.colors WHERE id=${Q(colIds[0])}`)).name;
  const cOnly = await asAdmin(`public.resolve_order_variant(${Q(P_COLORS.id)}, '', ${Q(cName0)})`);
  check("a colour-only product resolves by colour", typeof one(cOnly)?.resolve_order_variant, "string");

  console.log("\n=== 8. clearing all options clears the matrix ===");
  await saveRes({ ...base, id: P_SIZES.id, title: "VT Sizes Only", slug: `${SLUG}-sizes-only`, size_ids: [] });
  check("the matrix is emptied", await count(
    `SELECT count(*)::int c FROM public.product_variants WHERE product_id=${Q(P_SIZES.id)}`), 0);
  check("and the links are emptied", await count(
    `SELECT count(*)::int c FROM public.product_sizes WHERE product_id=${Q(P_SIZES.id)}`), 0);

  console.log("\n=== 9. the storefront projection ===");
  const proj = await col1(`SELECT colors, sizes, color_palette_ids FROM public.products WHERE id=${Q(PID)}`);
  check("colours are projected with names and hex", proj.colors.length, colIds.length);
  check("every projected colour has a hex", proj.colors.every((c) => /^#[0-9a-f]{6}$/i.test(c.hex)), true);
  check("sizes are projected", proj.sizes.length, sizeIds.length);
  check("every projected size has a stock figure", proj.sizes.every((s) => typeof s.stock === "number"), true);
  check("per-size stock is the total across colours", proj.sizes[0].stock, 10);
  check("color_palette_ids mirrors the links", [...proj.color_palette_ids].sort(), [...colIds].sort());
  check("product_sizes links match", await count(
    `SELECT count(*)::int c FROM public.product_sizes WHERE product_id=${Q(PID)}`), sizeIds.length);
  check("product_colors links match", await count(
    `SELECT count(*)::int c FROM public.product_colors WHERE product_id=${Q(PID)}`), colIds.length);

  console.log("\n=== 10. promotion links ===");
  if (promoId) {
    await saveRes({ ...base, id: PID, promotion_ids: [promoId] });
    check("the promotion is linked", await count(
      `SELECT count(*)::int c FROM public.promotion_products WHERE product_id=${Q(PID)} AND promotion_id=${Q(promoId)}`), 1);
    await saveRes({ ...base, id: PID, promotion_ids: [] });
    check("clearing removes the link", await count(
      `SELECT count(*)::int c FROM public.promotion_products WHERE product_id=${Q(PID)}`), 0);
    check("an unknown promotion is refused", raiseOf(
      await save({ ...base, id: PID, promotion_ids: ["nope"] })), "unknown_promotion");
  } else {
    console.log("  (no promotion seeded, skipping)");
  }

  console.log("\n=== 11. authorisation ===");
  const asUser = (sub, expr) =>
    raw(
      `WITH ctx AS (SELECT set_config('request.jwt.claims', ${Q(
        JSON.stringify({ sub, role: "authenticated" })
      )}, true) s) SELECT ${expr} FROM ctx`
    );
  check("a non-admin cannot save", raiseOf(await asUser(
    "00000000-0000-0000-0000-0000000000ff",
    `public.admin_save_product_guarded(${J({ ...base, id: PID })})`)), "admin_required");
  // A token with an empty sub is malformed rather than merely unauthorised.
  // It must still come back as a clean refusal, not as a Postgres type error
  // from inside is_admin(), which is what this asserts.
  check("a token with an empty sub cannot save", raiseOf(await raw(
    `WITH ctx AS (SELECT set_config('request.jwt.claims', '{"sub":"","role":"anon"}', true) s)
     SELECT public.admin_save_product_guarded(${J({ ...base, id: PID })}) FROM ctx`)), "admin_required");
  check("is_admin does not raise on an empty sub", (await raw(
    `WITH ctx AS (SELECT set_config('request.jwt.claims', '{"sub":"","role":"anon"}', true) s)
     SELECT public.is_admin() AS ok FROM ctx`))[0].ok, false);

  console.log("\n=== 12. stock guards ===");
  // Section 10 re-saved PID from `base`, which carries no options, so the
  // matrix was correctly cleared. These checks need one, so it is rebuilt
  // rather than being run against an empty table.
  await saveRes({
    ...base,
    id: PID,
    color_ids: colIds,
    size_ids: sizeIds,
    variants: colIds.flatMap((c) => sizeIds.map((s, i) => ({ color_id: c, size_id: s, stock: i + 4 }))),
  });
  const vid = (await col1(
    `SELECT id FROM public.product_variants WHERE product_id=${Q(PID)} AND color_id IS NOT NULL LIMIT 1`)).id;
  const neg = await raw(
    `UPDATE public.product_variants SET stock=-5 WHERE id=${Q(vid)}`
  );
  check("a direct negative write is refused", raiseOf(neg), "negative_stock");
  check("stock was not changed", (await col1(
    `SELECT stock FROM public.product_variants WHERE id=${Q(vid)}`)).stock > 0, true);
  // A negative figure coming back in through the save function is refused by
  // the same guard, so the check covers the admin path as well as a raw one.
  check("a negative figure in a save is refused", raiseOf(await save({
    ...base, id: PID, color_ids: colIds, size_ids: sizeIds,
    variants: colIds.flatMap((c) => sizeIds.map((s) => ({ color_id: c, size_id: s, stock: -4 }))),
  })), "negative_stock");

  // ---------- promotion badge types
  //
  // get_effective_badges() returned the literal 'discount' for every
  // promotion, so a promotion labelled "Festive" rendered in the discount
  // red. A badge type is now read from the promotion.
  {
    const promo = (await col1(
      `INSERT INTO public.promotions (name, discount_type, discount_value, starts_at, ends_at, status, badge_label, badge_type)
       VALUES ('VT Festive', 'percentage', 15, now() - interval '1 day', now() + interval '1 day', 'active', 'Festive Drop', 'festive')
       RETURNING id`)).id;
    try {
      // get_effective_badges only reports a product a live promotion actually
      // covers, so the link is part of the fixture. Without it the function
      // correctly returns no row and the assertions would be testing nothing.
      await must(
        `INSERT INTO public.promotion_products (promotion_id, product_id) VALUES (${Q(promo)},${Q(PID)})
         ON CONFLICT DO NOTHING`);
      const festive = (await col1(
        `SELECT * FROM public.get_effective_badges(ARRAY[${Q(PID)}]::text[]) WHERE product_id=${Q(PID)}`));
      check("a festive promotion reports its own badge type", festive?.badge_type, "festive");
      check("and keeps its own label", festive?.badge_label, "Festive Drop");

      await must(`UPDATE public.promotions SET badge_type=NULL WHERE id=${Q(promo)}`);
      const unset = (await col1(
        `SELECT * FROM public.get_effective_badges(ARRAY[${Q(PID)}]::text[]) WHERE product_id=${Q(PID)}`));
      // NULL means an admin has not chosen. Treating it as a discount is what
      // the old hardcoded literal did for every promotion, so nothing changes
      // for a promotion that was never given a type.
      check("an unset badge type falls back to discount", unset?.badge_type, "discount");

      const bad = await raw(
        `UPDATE public.promotions SET badge_type='neon' WHERE id=${Q(promo)}`);
      check("an unknown badge type is refused by the check", bad.err !== undefined, true);
    } finally {
      await must(`DELETE FROM public.promotion_products WHERE promotion_id=${Q(promo)}`);
      await must(`DELETE FROM public.promotions WHERE id=${Q(promo)}`);
    }
  }

  // ---------- the price cannot be zero
  //
  // The check is NOT VALID, so it skipped the rows that already existed and
  // is enforced on everything written from here on. That is the whole point:
  // a product saved without a price used to become free without erroring.
  {
    const r = await raw(
      `UPDATE public.products SET price=0, regular_price=0 WHERE id=${Q(PID)}`);
    check("writing a zero price is refused", r.err !== undefined, true);
    check("and the price is unchanged", Number((await col1(
      `SELECT regular_price FROM public.products WHERE id=${Q(PID)}`)).regular_price) > 0, true);

    const r2 = await raw(
      `UPDATE public.products SET regular_price=NULL WHERE id=${Q(PID)}`);
    check("nulling the price is refused too", r2.err !== undefined, true);
  }

  console.log("\n=== 13. uniqueness of a pair ===");
  const dup = await raw(`
    INSERT INTO public.product_variants (product_id, color_id, size_id, variant_key)
    SELECT product_id, color_id, size_id, variant_key FROM public.product_variants
    WHERE id=${Q(vid)}`);
  check("a duplicate pair is refused", dup.err !== undefined, true);
} catch (e) {
  // An exception is a failure, not an exit. Without this the finally block
  // below reports a pass for a run that asserted nothing at all.
  console.error("\nTHREW: " + (e instanceof Error ? e.message : String(e)));
  fails++;
} finally {
  console.log("\n=== cleanup ===");
  await must(`DELETE FROM public.promotion_products WHERE product_id IN (SELECT id FROM public.products WHERE slug LIKE ${Q(likeSlug)})`);
  await must(`DELETE FROM public.product_variants WHERE product_id IN (SELECT id FROM public.products WHERE slug LIKE ${Q(likeSlug)})`);
  await must(`DELETE FROM public.product_colors WHERE product_id IN (SELECT id FROM public.products WHERE slug LIKE ${Q(likeSlug)})`);
  await must(`DELETE FROM public.product_sizes WHERE product_id IN (SELECT id FROM public.products WHERE slug LIKE ${Q(likeSlug)})`);
  await must(`DELETE FROM public.products WHERE slug LIKE ${Q(likeSlug)}`);
  await sweepResidue();
  await must(`DELETE FROM public.categories WHERE slug LIKE 'vt-%'`);
  await must(`DELETE FROM public.profiles WHERE id=${Q(ADM)}`);
  await must(`DELETE FROM auth.users WHERE id=${Q(ADM)}`);

  console.log(`\n${fails === 0 ? "ALL PRODUCT VARIANT CHECKS PASS" : fails + " FAILED"}`);
  process.exit(fails === 0 ? 0 : 1);
}
