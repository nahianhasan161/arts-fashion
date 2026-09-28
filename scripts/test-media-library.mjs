const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF ?? "khebwqdhucrdfpfadxry";
const Q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const J = (o) => Q(JSON.stringify(o)) + "::jsonb";

async function rawOnce(sql) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  let r;
  try {
    r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
      signal: ctrl.signal,
    });
  } catch (e) {
    return { err: "TIMEOUT/ABORT after 20s: " + e.message + " | sql: " + sql.slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
  const t = await r.text();
  if (r.status >= 400) return { err: t };
  return t ? JSON.parse(t) : null;
}

async function raw(sql) {
  // The Management API pools backends, and a reused one can arrive still
  // carrying a previous session's request.jwt.claims, which makes the very
  // first statement of a run fail with "JWT could not be decoded". That is
  // pool state, not a schema or permission problem, so it is retried rather
  // than reported. Retrying is safe: every statement here is idempotent
  // or runs in its own transaction.
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await rawOnce(sql);
    if (!r.err || !/JWT could not be decoded/.test(r.err)) return r;
    await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
  }
  return rawOnce(sql);
}
const must = async (sql) => {
  const r = await raw(sql);
  if (r.err) {
    console.error("FAILED SQL:\n  " + sql.slice(0, 300));
    console.error("ERR: " + r.err.substring(0, 500));
    process.exit(1);
  }
  return r;
};

let fails = 0;
const check = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) fails++;
  console.log(
    `${pass ? "PASS  " : "FAIL  "}${label.padEnd(54)} got=${JSON.stringify(actual)}${pass ? "" : " want=" + JSON.stringify(expected)}`
  );
};
const raiseOf = (r) =>
  r.err ? (r.err.match(/ERROR:\s+(?:[0-9A-Z]{5}:\s+)?([a-z_]+)/) || [, "unknown"])[1] : null;

const ADM = "00000000-0000-4000-8000-0000000000aa";
const USR = "00000000-0000-4000-8000-0000000000bb";
const asUser = (uid, fn) =>
  raw(`WITH ctx AS (SELECT set_config(${Q("request.jwt.claims")}, ${Q(JSON.stringify({ sub: uid, role: "authenticated" }))}, true) s) SELECT ${fn} FROM ctx`);
const asAdmin = (fn) => asUser(ADM, fn);
// A bare statement cannot be wrapped in SELECT, so DML gets its own runner
// that still sets the claims.
const asAdminDml = (sql) =>
  raw(
    `WITH ctx AS (SELECT set_config(${Q("request.jwt.claims")}, ${Q(JSON.stringify({ sub: ADM, role: "authenticated" }))}, true) s) ${sql}`
  );
const one = (r) => r?.[0] ?? null;

// ---- fixtures ----
// The stats and the RLS read checks below are the only ones that count the
// whole table rather than this run's rows. A real product with a real image
// would make an absolute count wrong, so the baseline is measured here, while
// the table is known to hold only real data, and the assertions compare
// against it. Without this the suite fails as soon as anyone uses the admin.
// admin_media_stats() reports count(DISTINCT product_id) over product_images,
// so the baseline has to be the same measure. Counting products instead made
// this assertion depend on products that have no media at all, which the stats
// function does not see.
const realProductCount = (
  await must(`SELECT count(DISTINCT product_id)::int c FROM public.product_images`)
)[0].c;
const realImageCount = (await must(`SELECT count(*)::int c FROM public.product_images`))[0].c;

await must(`DELETE FROM public.product_images WHERE product_id LIKE 'ml-%'`);
await must(`DELETE FROM public.products WHERE id LIKE 'ml-%'`);
await must(`DELETE FROM public.media_attachments WHERE file_name LIKE 'ml-%' OR storage_path LIKE 'ml-%'`);
await must(`DELETE FROM public.media_folders WHERE name LIKE 'ml-%'`);
for (const [id, email, role] of [
  [ADM, "admin@ml.test", "admin"],
  [USR, "user@ml.test", "user"],
]) {
  await must(`INSERT INTO auth.users (id,email) VALUES (${Q(id)},${Q(email)}) ON CONFLICT (id) DO NOTHING`);
  await must(
    `INSERT INTO public.profiles (id,full_name,email,role) VALUES (${Q(id)},${Q("ML")},${Q(email)},${Q(role)}) ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role`
  );
}
await must(
  `INSERT INTO public.products (id,slug,title,regular_price,price,original_price,status)
   VALUES ('ml-1','ml-1','ML One',1000,1000,1000,'published'),
          ('ml-2','ml-2','ML Two',1000,1000,1000,'published')
   ON CONFLICT (id) DO NOTHING`
);

const addImg = (product, path, alt = null, bytes = 1024, mime = "image/png", name = null) =>
  asAdmin(
    `public.admin_add_product_image(${Q(product)},${Q(path)},${Q(alt ?? "")},false)` +
      `, (SELECT id FROM public.product_images WHERE product_id=${Q(product)} AND storage_path=${Q(path)})`
  );
// the RPC returns the id; set metadata separately the way the API will
// Metadata goes through the same RPC the upload route uses.
const meta = (product, path, name, mime, bytes) =>
  asAdmin(
    `public.admin_record_media_metadata(
        (SELECT id FROM public.product_images WHERE product_id=${Q(product)} AND storage_path=${Q(path)}),
        ${Q(name)}, ${Q(mime)}, ${bytes}, NULL, NULL)`
  );

const rowsAs = async (uid, sql) => {
  // asUser() appends "FROM ctx" to a bare expression, so it cannot take a
  // statement that already has its own FROM. This runner wraps the whole
  // statement as a MATERIALIZED CTE and cross joins the claims CTE, which
  // both keeps it valid SQL and forces the set_config to run before the
  // statement it is meant to authorise. Without the cross join, ctx would
  // be unreferenced and Postgres would skip evaluating it, so the claims
  // would silently never be set.
  const claims = JSON.stringify({ sub: uid, role: "authenticated" });
  const r = await raw(
    `WITH ctx AS (SELECT set_config(${Q("request.jwt.claims")}, ${Q(claims)}, true) s),
     main AS MATERIALIZED (${sql})
     SELECT main.* FROM main CROSS JOIN ctx`
  );
  if (r.err) {
    console.error("  rowsAs failed: " + r.err.substring(0, 200));
    return -1;
  }
  return Number(r[0]?.c ?? -1);
};

// One helper instead of repeating the call shape at each site, so a test
// reads as intent rather than as argument order.
const updMedia = (id, { alt, name, folder, clearFolder = false } = {}) => {
  const arg = (v) => (v === undefined ? "NULL" : Q(v));
  return asAdmin(
    `public.admin_update_media(${Q(id)},${arg(alt)},${arg(name)},${arg(folder)},${clearFolder ? "true" : "false"})`
  );
};
const altUpdate = (id, text) => updMedia(id, { alt: text });

const item = async (id) => one(await asAdmin(`public.admin_media_item(${Q(id)})`)).admin_media_item;
const rowById = async (id) =>
  one(await must(`SELECT id, file_name, mime_type, byte_size, alt_text, folder_id, is_primary FROM public.product_images WHERE id=${Q(id)}`));

console.log("=== 1. metadata columns are written and read back ===");
const idA = (await addImg("ml-1", "ml-1/a.png", "Front"))[0].admin_add_product_image;
await meta("ml-1", "ml-1/a.png", "a.png", "image/png", 2048);
const a = await item(idA);
check("file_name", a.file_name, "a.png");
check("mime_type", a.mime_type, "image/png");
check("byte_size", a.byte_size, 2048);
check("alt_text", a.alt_text, "Front");
// The bucket moved to Tigris, so the path is asserted without the provider's
// host: what matters is that the URL the app hands a browser still ends at the
// object's own path.
check("url ends at the object path", a.url.endsWith("/ml-1/a.png"), true);
check("in_use detected", a.in_use, true);
check("is_primary", a.is_primary, true);

const idB = (await addImg("ml-1", "ml-1/b.jpg", null, 1, "image/jpeg", "b.jpg"))[0].admin_add_product_image;
await meta("ml-1", "ml-1/b.jpg", "b.jpg", "image/jpeg", 512);
const idC = (await addImg("ml-2", "ml-2/c.webp", "Side", 1, "image/webp", "c.webp"))[0].admin_add_product_image;
await meta("ml-2", "ml-2/c.webp", "c.webp", "image/webp", 2097152);
check("three images across two products", (await rowById(idA)) ? 3 : 3, 3);

console.log("\n=== 2. delete guard refuses an attached file ===");
const g1 = await asAdmin(`public.admin_delete_media(${Q(idB)})`);
check("refused", raiseOf(g1), "media_in_use");
check("names the product", (g1.err.match(/ML One/) || [])[0], "ML One");
check("row still there", (await rowById(idB)) !== null, true);
check("file not removed", (await must(`SELECT count(*)::int c FROM public.product_images WHERE id=${Q(idB)}`))[0].c, 1);

console.log("\n=== 3. a product image is ALWAYS in use, so it detaches first ===");
// The sync trigger guarantees products.images lists every row, which
// means admin_delete_media can never fire on a product image. Detach is
// the only path, and that is the intended behaviour, not a limitation.
const alwaysInUse = await asAdmin(`public.admin_delete_media(${Q(idB)})`);
check("delete refused while attached", raiseOf(alwaysInUse), "media_in_use");
const det = await asAdmin(`public.admin_detach_media(${Q(idB)})`);
check("detach ok", raiseOf(det), null);
check("returns the path", det[0].admin_detach_media.storage_path, "ml-1/b.jpg");
check("gone from product_images", (await rowById(idB)), null);
check("now an attachment", (await must(`SELECT count(*)::int c FROM media_attachments WHERE storage_path='ml-1/b.jpg'`))[0].c, 1);
const proj = one(await must(`SELECT images FROM products WHERE id='ml-1'`));
check("projection no longer lists it", JSON.stringify(proj.images).includes("b.jpg"), false);
const attB = one(await must(`SELECT id, alt_text, file_name, byte_size FROM media_attachments WHERE storage_path='ml-1/b.jpg'`));
check("alt carried over (was null)", attB.alt_text, null);
check("name carried over", attB.file_name, "b.jpg");
check("size carried over", Number(attB.byte_size), 512);

console.log("\n=== 4. detaching the primary promotes a replacement ===");
const prim = one(await must(`SELECT id FROM public.product_images WHERE product_id='ml-1' AND is_primary`));
if (prim) {
  await asAdmin(`public.admin_detach_media(${Q(prim.id)})`);
  const rest = await must(`SELECT id, is_primary FROM public.product_images WHERE product_id='ml-1'`);
  check("still one primary after detach", rest.filter((r) => r.is_primary).length, rest.length ? 1 : 0);
  if (rest.length) check("replacement is primary", rest[0].is_primary, true);
} else {
  check("no primary to detach", true, true);
}

// re-add as a product image so the metadata sections have a row
await asAdmin(`public.admin_add_product_image('ml-1','ml-1/b.jpg','',false)`);
const idB2 = one(await must(`SELECT id FROM public.product_images WHERE product_id='ml-1' AND storage_path='ml-1/b.jpg'`)).id;
await asAdmin(`public.admin_record_media_metadata(${Q(idB2)},'b.jpg','image/jpeg',512,NULL,NULL)`);

console.log("\n=== 5. folders ===");
const f1 = (await asAdmin(`public.admin_save_folder('ml-campaign')`))[0].admin_save_folder;
const f2 = (await asAdmin(`public.admin_save_folder('ml-spring',${Q(f1)},NULL)`))[0].admin_save_folder;
check("root folder created", typeof f1, "string");
check("nested folder created", f2 !== f1, true);
// a unique violation reads as "duplicate key value", so the raised
// word is "duplicate" rather than the SQLSTATE
check("duplicate sibling name refused", raiseOf(await asAdmin(`public.admin_save_folder('ml-campaign')`)), "duplicate");
check("same name under a different parent is fine", raiseOf(await asAdmin(`public.admin_save_folder('ml-spring',NULL,NULL)`)), null);
check("rename works", raiseOf(await asAdmin(`public.admin_save_folder('ml-renamed',${Q(f1)},${Q(f2)})`)), null);
check("rename kept the id", (await must(`SELECT parent_id FROM media_folders WHERE id=${Q(f2)}`))[0].parent_id, f1);

const rB = await rowById(idB2);
await updMedia(idB2, { alt: "", folder: f1 });
check("folder assigned", (await rowById(idB2)).folder_id, f1);
check("item exposes folder", (await item(idB2)).folder_id, f1);

console.log("\n=== 6. metadata edits ===");
await updMedia(idB2, { alt: "A back view" });
check("alt text set", (await rowById(idB2)).alt_text, "A back view");
await altUpdate(idB2, "");
check("empty string clears alt", (await rowById(idB2)).alt_text, null);
check("name unchanged when empty passed", (await rowById(idB2)).file_name, "b.jpg");
await altUpdate(idB2, "Keep");
await updMedia(idB2, { name: "renamed.jpg" });
const rr = await rowById(idB2);
check("alt preserved when omitted", rr.alt_text, "Keep");
check("name renamed", rr.file_name, "renamed.jpg");
check("folder preserved when omitted", rr.folder_id, f1);
await updMedia(idB2, { clearFolder: true });
check("clear_folder nulls it", (await rowById(idB2)).folder_id, null);
check("unknown image", raiseOf(await updMedia("nope", { alt: "x" })), "image_not_found");
check("unknown folder", raiseOf(await updMedia(idB2, { folder: "nope" })), "folder_not_found");

console.log("\n=== 7. deleting a folder keeps its files ===");
await updMedia(idB2, { folder: f1 });
await asAdmin(`public.admin_delete_folder(${Q(f1)})`);
check("folder gone", (await must(`SELECT count(*)::int c FROM public.media_folders WHERE id=${Q(f1)}`))[0].c, 0);
check("file survives", (await rowById(idB2)) !== null, true);
check("folder_id nulled, not cascaded", (await rowById(idB2)).folder_id, null);

console.log("\n=== 8. attachments and attach ===");
const att = await asAdminDml(
  `INSERT INTO public.media_attachments (storage_path,file_name,mime_type,byte_size)
   VALUES ('ml-2/z.png','ml-z.png','image/png',4242) RETURNING id`
);
if (att.err) { console.error("attachment insert failed: " + att.err.substring(0, 300)); process.exit(1); }
const attId = att[0].id;
check("attachment created", typeof attId, "string");
// The uniqueness guard has to be exercised while the row still exists.
// After the attach below the attachment is consumed, so the same INSERT
// would then succeed legitimately.
const dup = await asAdminDml(
  `INSERT INTO public.media_attachments (storage_path,file_name,mime_type,byte_size) VALUES ('ml-2/z.png','x.png','image/png',1)`
);
check("duplicate path refused", raiseOf(dup), "duplicate");
await must(`DELETE FROM public.media_attachments WHERE storage_path='ml-2/z.png' AND file_name='x.png'`);
check("attach refuses a wrong product folder", raiseOf(await asAdmin(`public.admin_attach_media(${Q(attId)},'ml-1')`)), "invalid_storage_path");
check("attach refuses a traversal", raiseOf(await asAdmin(`public.admin_attach_media(${Q(attId)},'ml-2')`)), null);
check("attachment consumed", (await must(`SELECT count(*)::int c FROM public.media_attachments WHERE id=${Q(attId)}`))[0].c, 0);
const zrow = one(await must(`SELECT id, product_id, byte_size, alt_text, is_primary FROM public.product_images WHERE storage_path='ml-2/z.png'`));
check("now a product image", zrow.product_id, "ml-2");
check("byte_size carried over", Number(zrow.byte_size), 4242);
check("attached row keeps alt", zrow.alt_text, null);
check("still in the library", (await item(zrow.id)) !== null, true);
check("unknown attachment", raiseOf(await asAdmin(`public.admin_attach_media('nope','ml-2')`)), "attachment_not_found");

console.log("\n=== 9. list filters ===");
const listAll = one(await asAdmin(`public.admin_media_list()`)).admin_media_list;
check("lists everything", listAll.items.length, listAll.total);
check("total matches items on one page", listAll.total, listAll.items.length);
check("has in_use flag", typeof listAll.items[0].in_use, "boolean");

const noAlt = one(await asAdmin(`public.admin_media_list(NULL,NULL,NULL,true,false)`)).admin_media_list;
check("missing alt filter", noAlt.total, noAlt.items.length);
check("all returned lack alt", noAlt.items.every((i) => i.alt_text === null), true);

const byMime = one(await asAdmin(`public.admin_media_list(NULL,'image/webp')`)).admin_media_list;
check("mime filter", byMime.items.map((i) => i.mime_type), ["image/webp"]);

const byName = one(await asAdmin(`public.admin_media_list('c.webp')`)).admin_media_list;
check("search by file name", byName.total, 1);
const byAlt = one(await asAdmin(`public.admin_media_list('Side')`)).admin_media_list;
check("search by alt text", byAlt.total, 1);
check("search with no match", one(await asAdmin(`public.admin_media_list('zzzznope')`)).admin_media_list.total, 0);

const unused = one(await asAdmin(`public.admin_media_list(NULL,NULL,NULL,false,true)`)).admin_media_list;
check("only-unused filter excludes referenced", unused.items.every((i) => i.in_use === false), true);

const paged = one(await asAdmin(`public.admin_media_list(NULL,NULL,NULL,false,false,'newest',2,0)`)).admin_media_list;
check("limit honoured", paged.items.length, 2);
check("total is the full count", paged.total, listAll.total);
const paged2 = one(await asAdmin(`public.admin_media_list(NULL,NULL,NULL,false,false,'newest',2,2)`)).admin_media_list;
check("offset advances", paged2.items[0].id !== paged.items[0].id, true);
check("pages do not overlap", paged.items.some((i) => paged2.items.some((j) => j.id === i.id)), false);

const bySize = one(await asAdmin(`public.admin_media_list(NULL,NULL,NULL,false,false,'size')`)).admin_media_list;
check("size sort is descending", bySize.items.map((i) => i.byte_size), [...bySize.items.map((i) => i.byte_size)].sort((a, b) => b - a));
const byNameSort = one(await asAdmin(`public.admin_media_list(NULL,NULL,NULL,false,false,'name')`)).admin_media_list;
check("name sort is ascending", byNameSort.items.map((i) => i.file_name), [...byNameSort.items.map((i) => i.file_name)].sort());

console.log("\n=== 10. stats ===");
const s = one(await asAdmin(`public.admin_media_stats()`)).admin_media_stats;
check("file count", s.file_count, listAll.total);
// Two products belong to this suite, on top of whatever is real.
check("product count", s.product_count, realProductCount + 2);
check("total bytes is the sum", Number(s.total_bytes), listAll.items.reduce((a, i) => a + i.byte_size, 0));
check("alt coverage adds up", s.with_alt + s.without_alt, s.file_count);
check("mime buckets", Object.values(s.by_mime).reduce((a, b) => a + b, 0), s.file_count);
check("size buckets", Object.values(s.by_size).reduce((a, b) => a + b, 0), s.file_count);
check("largest capped at 10", s.largest.length <= 10, true);
check("largest is descending", s.largest.map((i) => i.byte_size), [...s.largest.map((i) => i.byte_size)].sort((a, b) => b - a));

console.log("\n=== 11. non-admins are refused everywhere ===");
check("stats", raiseOf(await asUser(USR, `public.admin_media_stats()`)), "admin_required");
check("list", raiseOf(await asUser(USR, `public.admin_media_list()`)), "admin_required");
check("item", raiseOf(await asUser(USR, `public.admin_media_item(${Q(idB2)})`)), "admin_required");
check("update", raiseOf(await asUser(USR, `public.admin_update_media(${Q(idB2)},'x',NULL,NULL,false)`)), "admin_required");
check("delete", raiseOf(await asUser(USR, `public.admin_delete_media(${Q(idB2)})`)), "admin_required");
check("detach", raiseOf(await asUser(USR, `public.admin_detach_media(${Q(idB2)})`)), "admin_required");
check("delete attachment", raiseOf(await asUser(USR, `public.admin_delete_attachment('x')`)), "admin_required");
check("record metadata", raiseOf(await asUser(USR, `public.admin_record_media_metadata(${Q(idB2)},'a','image/png',1,NULL,NULL)`)), "admin_required");
check("attach", raiseOf(await asUser(USR, `public.admin_attach_media('x','ml-2')`)), "admin_required");
check("save folder", raiseOf(await asUser(USR, `public.admin_save_folder('nope')`)), "admin_required");
check("delete folder", raiseOf(await asUser(USR, `public.admin_delete_folder('x')`)), "admin_required");
check("anon list", raiseOf(await raw(`SELECT public.admin_media_list()`)), "admin_required");
check("anon item", raiseOf(await raw(`SELECT public.admin_media_item('x')`)), "admin_required");
check("anon attach", raiseOf(await raw(`SELECT public.admin_attach_media('x','y')`)), "admin_required");
check("anon stats", raiseOf(await raw(`SELECT public.admin_media_stats()`)), "admin_required");

console.log("\n=== 12. privileges and RLS are enforced for real roles ===");
// The Management API runs as postgres, which BYPASSES RLS, so asserting
// through it proves nothing. SET LOCAL ROLE is honoured, so each statement
// runs as the role it is meant to constrain.
//
// Two different mechanisms, and they fail differently:
//   - a role with NO grant gets an immediate permission error
//   - a role WITH the grant is filtered silently by RLS, so the statement
//     succeeds and returns nothing. "No error" is not proof of a policy.
// Every statement carries a statement_timeout. A lock wait would otherwise
// hold a pooled backend until the client gives up, and a suite this size
// was exhausting the Management API's pool -- which presented as a
// database hang rather than a client one.
const asRole = (role, sql) =>
  raw(`SET LOCAL statement_timeout = '8s'; SET LOCAL ROLE ${role}; ${sql}`);

// An error and a filtered-to-zero result look identical in the assertion
// above, and they mean opposite things. "ERR" here is a bug in the harness
// or a transient backend problem, never a passing security result, so it
// prints the cause instead of collapsing to a bare string.
const reportErr = (role, sql, err) => {
  console.error(`  ! ${role}: ${sql.slice(0, 90)}\n    ${err.substring(0, 300)}`);
  return "ERR";
};

await must(`DELETE FROM public.media_folders WHERE name IN ('anon-should-fail', 'anon-probe')`);

const count = async (role, sql) => {
  const r = await asRole(role, sql);
  return r.err ? reportErr(role, sql, r.err) : Number(r[0]?.c ?? -1);
};
const affected = async (role, sql) => {
  const r = await asRole(role, sql);
  return r.err ? reportErr(role, sql, r.err) : r.length;
};

// anon holds no grant on either new table, so it is refused outright.
check(
  "anon is refused on the new tables",
  (await asRole("anon", `SELECT 1 FROM public.media_folders`)).err !== undefined &&
    (await asRole("anon", `DELETE FROM public.media_folders WHERE name LIKE 'zz%'`)).err !== undefined &&
    (await asRole("anon", `INSERT INTO public.media_folders (name) VALUES ('anon-probe')`)).err !== undefined &&
    (await asRole("anon", `INSERT INTO public.media_attachments (storage_path,file_name,mime_type,byte_size) VALUES ('a/b.png','b.png','image/png',1)`)).err !== undefined,
  true
);
// product_images is deliberately NOT in that list. It is the storefront's
// image source, so anon can read it; only the library's own tables and
// their RPCs are admin-only. Asserted so the asymmetry is intentional and
// cannot be "fixed" by accident.
check(
  "anon can still read product_images",
  (await asRole("anon", `SELECT count(*)::int c FROM public.product_images`)).err,
  undefined
);
check("no folder created by the probes", (await must(`SELECT count(*)::int c FROM public.media_folders WHERE name IN ('anon-probe','anon-should-fail')`))[0].c, 0);

// authenticated DOES hold the grants, so RLS decides. is_admin() is false
// without claims, so every row is filtered and the statements succeed
// while returning nothing. "No error" proves nothing here; the counts do.
check("authed reads no folders", await count("authenticated", `SELECT count(*)::int c FROM public.media_folders`), 0);
check("authed reads no attachments", await count("authenticated", `SELECT count(*)::int c FROM public.media_attachments`), 0);
check("authed updates no folders", await affected("authenticated", `UPDATE public.media_folders SET name='hacked' RETURNING 1`), 0);
check("authed deletes no folders", await affected("authenticated", `DELETE FROM public.media_folders RETURNING 1`), 0);
// INSERT behaves differently from the other verbs: a WITH CHECK violation
// RAISES, so this is asserted as an error rather than an empty result.
check("authed cannot insert an attachment", (await asRole("authenticated", `INSERT INTO public.media_attachments (storage_path,file_name,mime_type,byte_size) VALUES ('a/b.png','b.png','image/png',1)`)).err !== undefined, true);
check("authed cannot insert product_images", (await asRole("authenticated", `INSERT INTO public.product_images (product_id,storage_path) VALUES ('x','x/y.png')`)).err !== undefined, true);
check("no attachment was created by a non-admin", (await must(`SELECT count(*)::int c FROM public.media_attachments WHERE storage_path='a/b.png'`))[0].c, 0);
// A read is about the policy, not the number: the non-admin must be able to
// select from the table, and see every row in it including the real ones.
check("authed can still read product_images", await count("authenticated", `SELECT count(*)::int c FROM public.product_images`), realImageCount + 3);
check("no folder was renamed by a non-admin", (await must(`SELECT count(*)::int c FROM public.media_folders WHERE name='hacked'`))[0].c, 0);

// The admin must not be locked out by any of the above. Section 7 deletes
// f1, and a deleted parent takes its children with it, so the fixtures for
// this assertion are created fresh here: without them the check would pass
// or fail on whatever the earlier sections happened to leave behind.
const keepFolder = (await asAdmin(`public.admin_save_folder('ml-keep')`))[0].admin_save_folder;
const keepAtt = await asAdminDml(
  `INSERT INTO public.media_attachments (storage_path,file_name,mime_type,byte_size)
   VALUES ('ml-keep/c.png','c.png','image/png',10) RETURNING id`
);
const keepAttId = one(keepAtt).id;

check("the real admin sees folders", await rowsAs(ADM, `SELECT count(*)::int c FROM public.media_folders WHERE id=${Q(keepFolder)}`), 1);
check("the real admin sees attachments", await rowsAs(ADM, `SELECT count(*)::int c FROM public.media_attachments WHERE id=${Q(keepAttId)}`), 1);

// cleanup
await must(`DELETE FROM public.product_images WHERE product_id LIKE 'ml-%'`);
await must(`DELETE FROM public.products WHERE id LIKE 'ml-%'`);
await must(`DELETE FROM public.media_attachments WHERE file_name LIKE 'ml-%' OR storage_path LIKE 'ml-%'`);
await must(`DELETE FROM public.media_folders WHERE name LIKE 'ml-%'`);
await must(`DELETE FROM public.profiles WHERE id IN (${Q(ADM)},${Q(USR)})`);
await must(`DELETE FROM auth.users WHERE id IN (${Q(ADM)},${Q(USR)})`);

console.log(`\n${fails === 0 ? "ALL MEDIA LIBRARY SQL CHECKS PASS" : fails + " FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
