/**
 * HTTP-level checks for every /api/admin/media route.
 *
 * The SQL suite proves the functions behave; this proves the routes are
 * wired to them correctly: the status codes, the JSON shapes the client
 * actually reads, and the guards that only exist at the HTTP boundary.
 *
 * A real session is used, because a route that requires a cookie and a
 * profile with role=admin cannot be meaningfully tested by asserting on
 * 401s alone. So the script creates an admin, signs in for real, and then
 * cleans up every row and object it made.
 *
 *   node scripts/test-media-api.mjs [baseUrl]
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
    `${pass ? "PASS  " : "FAIL  "}${label.padEnd(52)} got=${JSON.stringify(actual)}${pass ? "" : " want=" + JSON.stringify(expected)}`
  );
};
const ok = (label, cond) => check(label, Boolean(cond), true);

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
const must = async (q) => sql(q);

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

/** A real PNG: 1x1, so uploads are bytes on the wire and not fixtures. */
function pngBytes() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
}
function file(name, bytes, type = "image/png") {
  const f = new File([bytes], name, { type });
  return f;
}

// ---------------------------------------------------------------- fixtures

const ADMIN = "00000000-0000-4000-8000-0000000000cc";
const PLAIN = "00000000-0000-4000-8000-0000000000dd";
const PWD = "ht-" + Math.random().toString(36).slice(2) + "-Aa1!";
const PRODUCT = crypto.randomUUID();
const paths = [];

/**
 * The Management API token is a personal access token, not a JWT, so it
 * cannot authorise the Auth admin API. The users are therefore created
 * through SQL, with the password hashed by pgcrypto exactly as GoTrue
 * would, and the profile row written alongside in one statement so the
 * admin check can never run against a user that has no profile.
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
  // GoTrue requires an identity row to sign in with the password grant,
  // not just a users row, so a user without one is invisible to /token.
  await must(`
    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider,
                                 last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), ${Q(id)}, ${Q(id)},
      ${J({ sub: id, email, email_verified: true })}, 'email',
      now(), now(), now())
    ON CONFLICT DO NOTHING
  `);
  await must(
    `INSERT INTO public.profiles (id,email,full_name,role) VALUES (${Q(id)},${Q(email)},'HTTP Test',${Q(role)})
     ON CONFLICT (id) DO UPDATE SET role=${Q(role)}`
  );
  return id;
}

/**
 * Exchanges the password grant for a session, then asks @supabase/ssr to
 * write the cookie itself.
 *
 * The cookie is deliberately not hand-built. @supabase/ssr chunks it and
 * prefixes the value, and that layout has changed between releases, so a
 * cookie assembled here would be rejected by the server and every route
 * would answer 401 for reasons that have nothing to do with the media
 * API. Letting the same library the server uses write it removes the
 * guesswork.
 */
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
  // The access token is returned alongside the cookie because the Storage
  // API will not accept the Management token, and cleanup needs one.
  return { cookie: cookies.join("; "), accessToken: j.access_token };
}

/**
 * Removes everything this run created: the rows it inserted, the objects it
 * uploaded, and the two test users.
 *
 * Two things here were learned the hard way and are worth stating.
 *
 * The Management API token is a personal access token, not a JWT, so the
 * Storage API rejects it. Storage therefore has to be cleaned with a real
 * access token, which means the admin has to still exist when cleanup
 * runs. Cleanup is called once before the users are created, to clear a
 * previous aborted run, and that early call has no token; it reports how
 * many orphans it found rather than silently leaving them.
 *
 * Rows are matched by the paths and ids this run recorded, not by a name
 * pattern. A staged file's path starts with unattached/ and its name is the
 * client's filename, so a pattern like "ht-%" on storage_path matches
 * nothing and every staged file survives.
 */
async function cleanup({ token, expectClean = false } = {}) {
  const rows = await sql(
    `SELECT name FROM storage.objects
      WHERE bucket_id='product-images'
        AND (name LIKE ${Q("unattached/%")} OR name LIKE ${Q(PRODUCT + "/%")})`
  );
  const orphanPaths = rows.map((r) => r.name);

  if (orphanPaths.length) {
    if (token) {
      for (const p of orphanPaths) {
        const res = await fetch(
          `${supabaseUrl}/storage/v1/object/product-images/${p.split("/").map(encodeURIComponent).join("/")}`,
          { method: "DELETE", headers: { apikey: publishable, Authorization: `Bearer ${token}` } }
        );
        if (!res.ok && res.status !== 404) {
          console.error(`  ! could not remove ${p}: ${res.status}`);
        }
      }
    } else {
      console.log(
        `  note: ${orphanPaths.length} orphaned object(s) from a previous run; ` +
          "they need a signed-in admin to remove, which this pre-run pass does not have"
      );
    }
  }

  await must(`DELETE FROM public.product_images WHERE product_id=${Q(PRODUCT)}`);
  await must(
    `DELETE FROM public.media_attachments
      WHERE storage_path = ANY(ARRAY[${paths.map(Q).join(",") || "''"}])
         OR storage_path LIKE ${Q("unattached/%")}`
  );
  await must(`DELETE FROM public.products WHERE id=${Q(PRODUCT)}`);
  await must(`DELETE FROM public.media_folders WHERE name LIKE 'ht-%'`);
  await must(`DELETE FROM public.profiles WHERE id IN (${Q(ADMIN)},${Q(PLAIN)})`);
  await must(`DELETE FROM auth.users WHERE id IN (${Q(ADMIN)},${Q(PLAIN)})`);
  paths.length = 0;

  if (expectClean) {
    const left = await sql(
      `SELECT count(*)::int c FROM storage.objects
        WHERE bucket_id='product-images'
          AND (name LIKE ${Q("unattached/%")} OR name LIKE ${Q(PRODUCT + "/%")})`
    );
    if (left[0].c !== 0) {
      console.error(`  ! ${left[0].c} object(s) survived cleanup`);
      fails++;
    }
  }
}

await cleanup();
await createAuthUser(ADMIN, "http-admin@test.local", "admin");
await createAuthUser(PLAIN, "http-plain@test.local", "user");
const adminSession = await signIn("http-admin@test.local");
cookie = adminSession.cookie;

await must(
  // regular_price is required. products_regular_price_positive refuses a
  // missing or zero price, which is the constraint added in the 20260927110000
  // migration, so a fixture without one is now correctly rejected.
  `INSERT INTO public.products (id, title, slug, regular_price, price, original_price)
   VALUES (${Q(PRODUCT)},'HTTP Test Product',${Q(PRODUCT + "-slug")},1000,1000,1000)
   ON CONFLICT (id) DO NOTHING`
);

const nonAdminCookie = (await signIn("http-plain@test.local")).cookie;

try {
  // ------------------------------------------------------------ 1. auth
  console.log("\n=== 1. authentication and authorisation ===");
  check("no cookie is 401", (await api("GET", "/api/admin/media", undefined, { noAuth: true })).status, 401);
  check("non-admin is 403", (await api("GET", "/api/admin/media", undefined, { noAuth: false }) && (await (async () => {
    const keep = cookie; cookie = nonAdminCookie;
    const r = await api("GET", "/api/admin/media"); cookie = keep; return r;
  })())).status, 403);
  check("admin gets 200", (await api("GET", "/api/admin/media")).status, 200);
  check("stats requires admin", (await (async () => {
    const keep = cookie; cookie = nonAdminCookie;
    const r = await api("GET", "/api/admin/media/stats"); cookie = keep; return r;
  })()).status, 403);

  // ------------------------------------------------------------ 2. list
  console.log("\n=== 2. GET /api/admin/media ===");
  const empty = await api("GET", "/api/admin/media");
  check("list shape", Object.keys(empty.body).sort(), ["items", "limit", "offset", "total"]);
  ok("items is an array", Array.isArray(empty.body.items));
  check("default limit", empty.body.limit, 60);
  check("default offset", empty.body.offset, 0);
  ok("total is a number", typeof empty.body.total === "number");

  // ------------------------------------------------------------ 3. upload
  console.log("\n=== 3. POST /api/admin/media (staging) ===");
  check("no files is 400", (await api("POST", "/api/admin/media", new FormData())).status, 400);

  const notAnImage = new FormData();
  notAnImage.append("files", file("evil.png", Buffer.from("#!/bin/sh\nrm -rf /", "utf8"), "text/plain"));
  const bad = await api("POST", "/api/admin/media", notAnImage);
  check("text file rejected, nothing uploaded", [bad.body.uploaded, bad.body.failed.length], [0, 1]);
  ok("rejection explains why", /unsupported|magic|not a|unsupported image/i.test(bad.body.failed[0].reason));

  const oversized = new FormData();
  oversized.append("files", file("big.png", Buffer.alloc(5 * 1024 * 1024 + 1024), "image/png"));
  const big = await api("POST", "/api/admin/media", oversized);
  check("oversized rejected", [big.body.uploaded, big.body.failed.length], [0, 1]);
  ok("size reason given", /5MB|5 MB|larger/i.test(big.body.failed[0].reason));

  const good = new FormData();
  good.append("files", file("ht-staged.png", pngBytes()));
  const up = await api("POST", "/api/admin/media", good);
  check("valid upload accepted", [up.body.uploaded, up.body.failed.length], [1, 0]);
  const staged = up.body.items[0];
  ok("attachment id returned", typeof staged.id === "string");
  paths.push(staged.storage_path);
  check("staged under unattached/", staged.storage_path.startsWith("unattached/"), true);
  ok("url is a public storage url", /^https:\/\/.+\/storage\/v1\/object\/public\/product-images\//.test(staged.url));
  ok("metadata recorded", staged.mime_type === "image/png" && staged.byte_size > 0);

  console.log("\n=== 4. folders ===");
  const f = await api("POST", "/api/admin/media/folders", { name: "ht-folder" });
  check("folder created", f.status, 201);
  const folderId = f.body.id;
  ok("folder id returned", typeof folderId === "string");
  check("empty name is 400", (await api("POST", "/api/admin/media/folders", { name: "  " })).status, 400);
  const dup = await api("POST", "/api/admin/media/folders", { name: "ht-folder" });
  check("duplicate name is 409", dup.status, 409);
  ok("duplicate explains", typeof dup.body.detail === "string");

  const tree = await api("GET", "/api/admin/media/folders");
  check("folders shape", Object.keys(tree.body).sort(), ["folders", "staged"]);
  ok("the new folder is listed", tree.body.folders.some((x) => x.id === folderId));
  ok("the staged file is listed", tree.body.staged.some((x) => x.id === staged.id));

  console.log("\n=== 5. attachment edits ===");
  const patched = await api("PATCH", `/api/admin/media/attachments/${staged.id}`, {
    alt_text: "A one pixel square",
    folder_id: folderId,
  });
  check("attachment patched", patched.status, 200);
  check("alt text stored", patched.body.item.alt_text, "A one pixel square");
  check("folder stored", patched.body.item.folder_id, folderId);
  check("unknown attachment is 404", (await api("PATCH", "/api/admin/media/attachments/nope", { alt_text: "x" })).status, 404);
  const cleared = await api("PATCH", `/api/admin/media/attachments/${staged.id}`, { alt_text: "" });
  check("empty string clears alt", cleared.body.item.alt_text, null);

  console.log("\n=== 6. attach and detach ===");
  check("attach needs product_id", (await api("POST", `/api/admin/media/${staged.id}/attach`, {})).status, 400);
  const attach = await api("POST", `/api/admin/media/${staged.id}/attach`, { product_id: PRODUCT });
  check("attach succeeds", attach.status, 200);
  ok("path moved into the product folder", String(attach.body.storage_path).startsWith(PRODUCT + "/"));
  paths.push(attach.body.storage_path);

  // Attach and detach are moves between two tables, so the row id changes
  // each time, and attach also mints a fresh storage path. The file NAME is
  // the only identifier that survives both, so every later step looks the
  // row up by that instead of carrying a stale id or path forward.
  const findByName = async (name) => {
    const r = await api("GET", `/api/admin/media?search=${encodeURIComponent(name)}`);
    return r.body.items.find((i) => i.file_name === name) ?? null;
  };
  const movedId = (await findByName("ht-staged.png"))?.id ?? null;
  ok("the attached row has a new id", typeof movedId === "string" && movedId !== staged.id);
  const oldRow = await sql(`SELECT 1 FROM public.product_images WHERE id=${Q(staged.id)}`);
  check("the attachment id no longer exists as a product image", oldRow.length, 0);

  const attached = await findByName("ht-staged.png");
  ok("attached file is in the library", Boolean(attached));
  check("it is no longer unattached", attached?.unattached, false);
  check("it knows its product", attached?.product_id, PRODUCT);
  check("it kept its file name", attached?.file_name, "ht-staged.png");
  ok("it kept its metadata", attached?.mime_type === "image/png" && attached?.byte_size > 0);

  const treeAfter = await api("GET", "/api/admin/media/folders");
  ok("it left the staging area", !treeAfter.body.staged.some((x) => x.id === staged.id));

  const detach = await api("POST", `/api/admin/media/${movedId}/detach`, {});
  check("detach succeeds", detach.status, 200);
  const treeAfterDetach = await api("GET", "/api/admin/media/folders");
  const restaged = treeAfterDetach.body.staged.find((x) => x.file_name === "ht-staged.png");
  ok("it is staged again", Boolean(restaged));
  // Detach is a move into the other table, so the id changes again.
  const restagedId = restaged?.id ?? null;
  ok("the staged row has a new id", typeof restagedId === "string" && restagedId !== movedId);
  const removed = await sql(`SELECT 1 FROM public.product_images WHERE id=${Q(movedId)}`);
  check("it is gone from product_images", removed.length, 0);

  console.log("\n=== 7. delete guard ===");
  const reattached = await api("POST", `/api/admin/media/${restagedId}/attach`, { product_id: PRODUCT });
  check("reattached", reattached.status, 200);
  paths.push(reattached.body.storage_path);
  const reattachedId = (await findByName("ht-staged.png"))?.id ?? null;
  ok("it is back on the product with a new id", typeof reattachedId === "string");

  const guarded = await api("DELETE", `/api/admin/media/${reattachedId}`);
  check("delete of an in-use image is 409", guarded.status, 409);
  check("the guard names the reason", guarded.body.error, "media_in_use");
  ok("the guard suggests the next step", typeof guarded.body.hint === "string" && /detach/i.test(guarded.body.hint));
  const stillThere = await sql(`SELECT 1 FROM public.product_images WHERE id=${Q(reattachedId)}`);
  check("the refused row survived", stillThere.length, 1);

  // Detaching moves the file to the staging table under a new id, so the
  // product-image delete is correctly a 404 here. The file is now deleted
  // through the staging endpoint, which is the branch the UI takes.
  await api("POST", `/api/admin/media/${reattachedId}/detach`, {});
  const afterGuard = await api("GET", "/api/admin/media/folders");
  const toDelete = afterGuard.body.staged.find((x) => x.file_name === "ht-staged.png");
  ok("the detached file is in the staging area", Boolean(toDelete));
  const gone = await api("DELETE", `/api/admin/media/attachments/${toDelete.id}`);
  check("delete after detach succeeds", gone.status, 200);
  const goneRow = await sql(`SELECT 1 FROM public.media_attachments WHERE id=${Q(toDelete.id)}`);
  check("the row is gone", goneRow.length, 0);
  check("delete of an unknown id is 404", (await api("DELETE", "/api/admin/media/nope")).status, 404);

  console.log("\n=== 8. media metadata edits ===");
  const direct = new FormData();
  direct.append("files", file("ht-direct.png", pngBytes()));
  direct.append("productId", PRODUCT);
  direct.append("alt_text", "Uploaded straight to the product");
  const directUp = await api("POST", "/api/admin/media", direct);
  check("direct upload accepted", [directUp.body.uploaded, directUp.body.failed.length], [1, 0]);
  const directList = await api("GET", "/api/admin/media?search=ht-direct");
  const img = directList.body.items[0];
  ok("it is attached to the product", img?.product_id === PRODUCT);
  paths.push(img.storage_path);

  const renamed = await api("PATCH", `/api/admin/media/${img.id}`, { file_name: "ht-renamed.png" });
  check("rename works", renamed.body.item.file_name, "ht-renamed.png");
  const alted = await api("PATCH", `/api/admin/media/${img.id}`, { alt_text: "Described" });
  check("alt text works", alted.body.item.alt_text, "Described");
  const unalted = await api("PATCH", `/api/admin/media/${img.id}`, { alt_text: null });
  check("null clears alt text", unalted.body.item.alt_text, null);
  const refiled = await api("PATCH", `/api/admin/media/${img.id}`, { folder_id: folderId });
  check("folder assign works", refiled.body.item.folder_id, folderId);
  const clearedFolder = await api("PATCH", `/api/admin/media/${img.id}`, { folder_id: null });
  check("folder clear works", clearedFolder.body.item.folder_id, null);
  check("unknown folder is 404", (await api("PATCH", `/api/admin/media/${img.id}`, { folder_id: "nope" })).status, 404);
  check("unknown image is 404", (await api("PATCH", "/api/admin/media/nope", { alt_text: "x" })).status, 404);

  console.log("\n=== 9. filters, search and sort ===");
  const bySearch = await api("GET", "/api/admin/media?search=ht-renamed");
  ok("search finds the renamed file", bySearch.body.items.some((i) => i.file_name === "ht-renamed.png"));
  const byMime = await api("GET", "/api/admin/media?mime=image/webp");
  ok("a mime filter excludes png", byMime.body.items.every((i) => i.mime_type === "image/webp"));
  const byMissingAlt = await api("GET", "/api/admin/media?missing_alt=true");
  ok("missing_alt only returns undescribed files", byMissingAlt.body.items.every((i) => !i.alt_text));
  ok("the undescribed file is included", byMissingAlt.body.items.some((i) => i.id === img.id));
  const byFolder = await api("GET", `/api/admin/media?folder=${folderId}`);
  check("filtering by an empty folder returns nothing", byFolder.body.items.length, 0);

  // Pagination needs at least two rows to be meaningful, and by this point
  // the earlier files have been detached and deleted, so a second image is
  // uploaded here rather than relying on what earlier sections left behind.
  const pageFill = new FormData();
  pageFill.append("files", file("ht-page2.png", pngBytes()));
  pageFill.append("productId", PRODUCT);
  const pageFillRes = await api("POST", "/api/admin/media", pageFill);
  check("a second image is available to page over", pageFillRes.body.uploaded, 1);
  const pageTotal = (await api("GET", "/api/admin/media")).body.total;
  ok("there are at least two library items", pageTotal >= 2);

  const p1 = await api("GET", "/api/admin/media?limit=1&offset=0");
  const p2 = await api("GET", "/api/admin/media?limit=1&offset=1");
  check("page one size", p1.body.items.length, 1);
  check("page two size", p2.body.items.length, 1);
  ok("the pages do not repeat a row", p1.body.items[0].id !== p2.body.items[0].id);
  check("limit is echoed", p1.body.limit, 1);
  check("offset is echoed", p2.body.offset, 1);
  const past = await api("GET", `/api/admin/media?limit=1&offset=${p1.body.total}`);
  check("past the end is empty, not an error", past.body.items.length, 0);
  const lastPage = await api("GET", `/api/admin/media?limit=${p1.body.total + 10}`);
  check("a limit past the total returns everything", lastPage.body.items.length, p1.body.total);

  for (const sort of ["newest", "oldest", "name", "size"]) {
    const r = await api("GET", `/api/admin/media?sort=${sort}`);
    check(`sort=${sort} is 200`, r.status, 200);
  }
  check("an unknown sort is rejected or ignored", (await api("GET", "/api/admin/media?sort=bogus")).status, 200);

  console.log("\n=== 10. stats ===");
  const stats = await api("GET", "/api/admin/media/stats");
  check("stats is 200", stats.status, 200);
  const required = [
    "total_bytes", "file_count", "with_alt", "without_alt", "product_count",
    "unattached_count", "by_mime", "by_size", "largest",
  ];
  check("stats has every documented key", required.filter((k) => !(k in stats.body)), []);
  ok("file_count is a number", typeof stats.body.file_count === "number");
  ok("by_mime is an object", typeof stats.body.by_mime === "object" && !Array.isArray(stats.body.by_mime));
  ok("by_size is an object", typeof stats.body.by_size === "object" && !Array.isArray(stats.body.by_size));
  ok("largest is an array", Array.isArray(stats.body.largest));
  ok("no bucket values are null", [stats.body.total_bytes, stats.body.file_count, stats.body.with_alt, stats.body.without_alt].every((v) => v !== null && v !== undefined));

  console.log("\n=== 11. folder rename and delete ===");
  const folderTree = await api("GET", "/api/admin/media/folders");
  const child = await api("POST", "/api/admin/media/folders", { name: "ht-child", parent_id: folderId });
  check("nested folder created", child.status, 201);
  const renamedFolder = await api("PATCH", `/api/admin/media/folders/${child.body.id}`, { name: "ht-child2" });
  check("folder renamed", renamedFolder.status, 200);
  const delFolder = await api("DELETE", `/api/admin/media/folders/${child.body.id}`);
  check("folder deleted", delFolder.status, 200);
  const goneFolder = await api("GET", "/api/admin/media/folders");
  ok("the folder is gone", !goneFolder.body.folders.some((x) => x.id === child.body.id));
  check("deleting an unknown folder is 404", (await api("DELETE", "/api/admin/media/folders/nope")).status, 404);

  console.log("\n=== 12. staging area delete ===");
  const staged2 = new FormData();
  staged2.append("files", file("ht-staged2.png", pngBytes()));
  const up2 = await api("POST", "/api/admin/media", staged2);
  const s2 = up2.body.items[0];
  paths.push(s2.storage_path);
  const delStaged = await api("DELETE", `/api/admin/media/attachments/${s2.id}`);
  check("staged file deleted", delStaged.status, 200);
  const goneStaged = await api("GET", "/api/admin/media/folders");
  ok("it is gone from staging", !goneStaged.body.staged.some((x) => x.id === s2.id));

  console.log("\n=== 13. the product editor route still works ===");
  const pml = await api("POST", `/api/admin/products/${PRODUCT}/media`, (() => {
    const fd = new FormData();
    fd.append("files", file("ht-pml.png", pngBytes()));
    fd.append("alt_text", "From the product editor");
    return fd;
  })());
  check("product media upload works", [pml.body.uploaded, pml.body.failed.length], [1, 0]);
  const pmlList = await api("GET", `/api/admin/products/${PRODUCT}/media`);
  ok("the product lists it", pmlList.body.data.some((i) => i.alt_text === "From the product editor"));
  const libSeesIt = await api("GET", "/api/admin/media?search=ht-pml");
  ok("the library sees the product editor's upload", libSeesIt.body.items.some((i) => i.file_name === "ht-pml.png"));
  const libSeesMime = libSeesIt.body.items[0];
  check("its metadata was recorded by the shared path", libSeesMime.mime_type, "image/png");
  ok("its size was recorded", libSeesMime.byte_size > 0);
} finally {
  await cleanup({ token: adminSession?.accessToken, expectClean: true });
  console.log(`\n${fails === 0 ? "ALL MEDIA API CHECKS PASS" : fails + " FAILED"}`);
}

process.exit(fails === 0 ? 0 : 1);
