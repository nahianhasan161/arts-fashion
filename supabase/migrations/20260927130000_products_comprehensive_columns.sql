-- ==========================================================
-- PRODUCTS: THE COLUMNS A PRODUCT RECORD WAS MISSING
--
-- The product row was load-bearing for a storefront and thin for a
-- catalogue. Five things it could not express:
--
--   deleted_at        whether a product was removed, as opposed to
--                     never having existed
--   published_at      when it went live, as opposed to when it was
--                     typed in
--   tags              a merchandising taxonomy
--   short_description a plain-text summary
--   cost_price        what it cost to buy
--
-- The first one is a correctness fix and is treated as such below: hard
-- DELETE is removed from the reachable surface entirely, so the column is
-- the only way a product leaves.
--
-- Every statement is idempotent. Nothing here assumes the table is empty;
-- the backfills are written to be correct over existing rows.
-- ==========================================================


-- ------------------------------------------------------------
-- 1. deleted_at — soft delete
-- ------------------------------------------------------------
--
-- The admin route issued a real DELETE. Postgres honoured six ON DELETE
-- CASCADE foreign keys (product_variants, product_images, product_colors,
-- product_sizes, promotion_products, coupon_products) and took the whole
-- authored product with it: the size/colour matrix, the price overrides, the
-- SKUs and every promotion link.
--
-- order_items.product_id is TEXT with no foreign key, deliberately, because
-- an order line must keep naming the product it was bought at even after the
-- catalogue moves on. That intent was not honoured by a hard delete: the line
-- survived pointing at a row that no longer existed, and order_items.variant_id
-- was left naming a variant row the cascade had already removed. The order
-- history was silently unresolvable and could not be repaired after the fact.
--
-- A soft delete keeps the row, the matrix, the media and the promotion links
-- addressable, and makes the removal reversible.
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN public.products.deleted_at IS
'Set when an admin removes the product. NULL is the normal state and means the '
'product is live data. A non-NULL value means it is retired: the row, its '
'variants, its media and its promotion links are all still present so that '
'order_items.product_id and order_items.variant_id keep resolving.';

-- published_at, tags, short_description and cost_price in one statement
-- group, then each one gets its own note below.
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    ADD COLUMN IF NOT EXISTS short_description TEXT,
    ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10, 2);


-- ------------------------------------------------------------
-- 2. published_at — when the product went live
-- ------------------------------------------------------------
--
-- status already recorded *whether* a product was published. It recorded
-- nothing about *when*, so the only time signal available to a shopper was
-- created_at, which is when the row was first typed in. A product drafted over
-- three weekends and published on a Thursday then appeared three weeks old to
-- every "new in" rail, because getProducts() sorts on created_at desc.
--
-- The value is set once, by a trigger, on the first transition into
-- 'published'. It is deliberately NOT cleared when the product is later
-- unpublished or archived: an order placed in June must still be explainable
-- as "this was live in June", and a stamp that disappears on unpublish cannot
-- answer that. Re-publishing later keeps the original date, which is the
-- correct reading of "first went live".
CREATE OR REPLACE FUNCTION public.products_set_published_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- INSERT: an admin may create straight into 'published'.
    IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
            NEW.published_at := now();
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE: stamp only on the transition, and only if never stamped. The
    -- status guard is what makes a re-publish keep the original date instead
    -- of resetting it to today.
    IF NEW.status = 'published'
       AND OLD.status IS DISTINCT FROM 'published'
       AND NEW.published_at IS NULL
    THEN
        NEW.published_at := now();
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_set_published_at ON public.products;
CREATE TRIGGER products_set_published_at
    BEFORE INSERT OR UPDATE OF status ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.products_set_published_at();

COMMENT ON COLUMN public.products.published_at IS
'First moment the product went live. Set once by a trigger and never cleared, '
'so a later unpublish keeps the original date. Rows published before this '
'column existed are backfilled from created_at.';

-- Backfill. Every product that is currently published is treated as having
-- been live since it was created, because created_at is the only honest
-- approximation available and the alternative leaves the column NULL on
-- exactly the rows the storefront is already showing. Drafts and archived
-- rows are left NULL on purpose: their first publication has not happened yet.
UPDATE public.products
   SET published_at = created_at
 WHERE published_at IS NULL
   AND status = 'published';

-- A deleted product is archived, so a soft-deleted published row keeps the
-- date it had. Nothing to backfill here beyond the statement above.


-- ------------------------------------------------------------
-- 3. tags — a merchandising taxonomy
-- ------------------------------------------------------------
--
-- specs is an untyped JSONB bag. It can hold a material, a fit, a neckline,
-- and it cannot be filtered by, ordered by, or indexed for containment on
-- any of them. There was no way to answer "show me everything tagged
-- 'Eid Collection'", which is the query a fashion storefront exists to answer.
--
-- TEXT[] rather than a tags table: the vocabulary is small, written only by
-- admins, never shared across products as an entity, and has no attributes of
-- its own. A join table would buy referential integrity nobody needs at the
-- cost of a second read on every listing. If tags ever need a description, a
-- landing page or a curator, promote them then.
--
-- Values are stored as written. Case folding happens at read time, not here,
-- so a tag is not silently rewritten by the database.
COMMENT ON COLUMN public.products.tags IS
'Free merchandising tags, e.g. {''summer'',''eid-collection''}. Admin-written '
'only. Stored verbatim; filter with a case-insensitive containment operator '
'rather than expecting normalised text.';


-- ------------------------------------------------------------
-- 4. short_description — the plain-text summary
-- ------------------------------------------------------------
--
-- description is the rich-text body rendered by RichTextEditor. Product cards,
-- search result rows and <meta name="description"> all need the opposite of
-- that: plain text, short, safe to put in an attribute. Deriving it by
-- stripping tags out of description would mean every consumer re-implementing
-- HTML stripping, and would silently change when an admin edits the body, so it
-- is a column an admin fills in.
--
-- The length bound is generous but real. The one live product has a NULL
-- description, which shows the field is already optional in practice; the
-- bound exists so a 4,000-character "short" description cannot be written and
-- then truncated by whatever renders it.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'products_short_description_length'
    ) THEN
        ALTER TABLE public.products
            ADD CONSTRAINT products_short_description_length
            CHECK (short_description IS NULL OR char_length(short_description) <= 320);
    END IF;
END;
$$;


-- ------------------------------------------------------------
-- 5. cost_price — what the product cost to buy
-- ------------------------------------------------------------
--
-- inventory_movements records quantity deltas and never value, and nothing
-- else in the schema stores acquisition cost. Margin, profit per unit, and the
-- cash value of closing stock were all uncomputable.
--
-- Nullable and never defaulted to a number. A zero default would be a claim
-- that the goods were free, and a NULL is the honest "not recorded yet" that
-- margin reports can filter on. cost_price must never exceed regular_price
-- either, but that is left to the admin form rather than constrained here:
-- a clearance sale priced below cost is a legitimate thing to do, and a
-- CHECK would turn that into an error at the worst moment.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'products_cost_price_non_negative'
    ) THEN
        ALTER TABLE public.products
            ADD CONSTRAINT products_cost_price_non_negative
            CHECK (cost_price IS NULL OR cost_price >= 0);
    END IF;
END;
$$;

COMMENT ON COLUMN public.products.cost_price IS
'Unit acquisition cost, in the same currency as regular_price. NULL means not '
'recorded. Kept out of every customer-facing price computation; it exists for '
'margin reporting only.';


-- ------------------------------------------------------------
-- 6. Soft delete as the only way out
-- ------------------------------------------------------------
--
-- Two functions rather than an UPDATE from the route, because the pairing that
-- makes a delete retrievable is the pairing that a client can forget: a row
-- marked deleted but left 'published' stays in the storefront's data and one
-- archived but left undeleted cannot be told apart from a product an admin
-- retired on purpose. Both states are decided once, here.
--
-- SECURITY DEFINER because the DELETE policy is removed below, and because
-- these must work from a role that RLS cannot express the check for.
--
-- Raise rather than return a flag, matching admin_save_product: the route
-- maps named exceptions to HTTP status codes through describeAdminError, and
-- a boolean return is the pattern that produced the silent zero-price bug.
CREATE OR REPLACE FUNCTION public.admin_soft_delete_product(p_product_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_row public.products%ROWTYPE;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
    END IF;

    IF p_product_id IS NULL OR btrim(p_product_id) = '' THEN
        RAISE EXCEPTION 'product_id_required' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_row FROM public.products WHERE id = p_product_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
    END IF;

    -- Deleting twice is an error rather than a no-op. A silent success would
    -- tell an admin a product was removed when it was already gone an hour
    -- ago, and the second click is usually the sign the first one failed.
    IF v_row.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'product_already_deleted' USING ERRCODE = '22023';
    END IF;

    -- status is set alongside deleted_at so a retired product is also
    -- unpublished. A row left 'published' with deleted_at set would still
    -- satisfy any storefront query that only filters on status.
    UPDATE public.products
       SET deleted_at = now(),
           status     = 'archived',
           updated_at = now()
     WHERE id = p_product_id;

    RETURN jsonb_build_object(
        'id', p_product_id,
        'slug', v_row.slug,
        'deleted_at', now()
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_restore_product(
    p_product_id TEXT,
    p_status     TEXT DEFAULT 'draft'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_row public.products%ROWTYPE;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
    END IF;

    IF p_status NOT IN ('draft', 'published', 'archived') THEN
        RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_row FROM public.products WHERE id = p_product_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
    END IF;

    IF v_row.deleted_at IS NULL THEN
        RAISE EXCEPTION 'product_not_deleted' USING ERRCODE = '22023';
    END IF;

    -- Restoring to 'archived' is legal but means the product is back in the
    -- data and still not buyable, which is the state a product deliberately
    -- retired by hand was in. Restoring to 'published' runs the same
    -- published_at trigger as any other transition, and because that trigger
    -- only stamps when the column is NULL, a product that was live before it
    -- was deleted keeps its original first-live date.
    UPDATE public.products
       SET deleted_at = NULL,
           status     = p_status,
           updated_at = now()
     WHERE id = p_product_id;

    RETURN jsonb_build_object(
        'id', p_product_id,
        'slug', v_row.slug,
        'status', p_status
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_soft_delete_product(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_soft_delete_product(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_restore_product(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_restore_product(TEXT, TEXT) TO authenticated;

-- The DELETE policy is withdrawn, not merely unused. Any client holding an
-- authenticated session could otherwise still reach a hard delete through
-- PostgREST, and every argument above about order_items.variant_id going
-- dangling would still be true of that path. Leaving a rule in place and
-- relying on the application to prefer the soft path is the same reasoning
-- that left products.images writable by the save route when it is a trigger's
-- projection.
DROP POLICY IF EXISTS "Admins can delete products" ON public.products;

COMMENT ON FUNCTION public.admin_soft_delete_product(TEXT) IS
'Retires a product. Sets deleted_at and archives it in one statement. Raises '
'product_already_deleted rather than repeating a no-op.';

COMMENT ON FUNCTION public.admin_restore_product(TEXT, TEXT) IS
'Un-retires a product. Defaults to draft, so a restore cannot put a product on '
'sale without a deliberate second decision.';


-- ------------------------------------------------------------
-- 7. Indexes
-- ------------------------------------------------------------
--
-- The listing index is the one that matters. It is partial because only live
-- rows can appear in a listing, and a partial index over a few thousand live
-- products stays in cache while the full-table index over all of them does not.
CREATE INDEX IF NOT EXISTS products_published_idx
    ON public.products (published_at DESC, id)
    WHERE status = 'published' AND deleted_at IS NULL;

-- Serves every storefront read, which now begins with two equality
-- predicates: deleted_at IS NULL and status = 'published'. Without this the
-- planner had a choice between the status index and a scan, and with the
-- default sort it had no reason to prefer either.
CREATE INDEX IF NOT EXISTS products_live_idx
    ON public.products (status, category_id, price)
    WHERE deleted_at IS NULL;

-- tags is filtered with && and <@, which need GIN. A btree cannot answer a
-- containment question over an array at all.
CREATE INDEX IF NOT EXISTS products_tags_idx
    ON public.products USING GIN (tags);

-- Retired rows are rare and always looked up by id, but the admin trash view
-- orders by when they were retired, and that is a full scan without this.
CREATE INDEX IF NOT EXISTS products_deleted_at_idx
    ON public.products (deleted_at DESC)
    WHERE deleted_at IS NOT NULL;


-- ------------------------------------------------------------
-- 8. Validate the price check, if the data allows it
-- ------------------------------------------------------------
--
-- products_regular_price_positive was added NOT VALID by the 2026-09-27 price
-- fix, because rows existed at that moment whose price had been lost to the
-- payload-key bug and could not be backfilled: the number had never been
-- stored, so there was nothing to recover. NOT VALID means the constraint is
-- enforced on new and updated rows but those historical rows were never
-- checked, and a row sitting at regular_price = 0 stays there silently.
--
-- Those rows have since been corrected, so the constraint can be enforced
-- against the whole table. It is wrapped in a block that swallows the error
-- on purpose: if any row is still at zero, this migration records nothing and
-- leaves the constraint NOT VALID rather than aborting every other statement
-- above and leaving the table half-migrated. The backfill, the triggers and
-- the indexes have already been applied by the time this runs, so a failure
-- here costs one follow-up statement and nothing else.
DO $$
BEGIN
    ALTER TABLE public.products VALIDATE CONSTRAINT products_regular_price_positive;
EXCEPTION
    WHEN check_violation THEN
        RAISE NOTICE
            'products_regular_price_positive left NOT VALID: % row(s) still have a non-positive regular_price',
            (SELECT count(*) FROM public.products
              WHERE regular_price IS NULL OR regular_price <= 0);
END;
$$;
