-- ==========================================================
-- TWO CORRECTIONS FOUND BY THE NEW TESTS
--
-- 1. The public read policy from 20260927132000 was written as
--
--       deleted_at IS NULL AND (status = 'published' OR is_admin())
--
--    The conjunction is wrong. It hides retired rows from ADMINS as well as
--    from the public, so the admin trash view could not see them: the route
--    asked for them with `?deleted=1` and RLS refused the rows, so the query
--    returned an empty list and looked like the product had never been
--    deleted.
--
--    An admin needs to see drafts and retired rows precisely because they
--    are editing and restoring them. The public arm is what must be narrow,
--    and the whole predicate is an OR of two complete clauses:
--
--       (published AND not retired) OR admin
--
--    Nothing is opened up as a side effect. The publishable key is not an
--    admin, so it still cannot read a draft or a retired row, and that is
--    what the test in section 15 checks over REST with the anon key.
--
-- 2. Tag de-duplication lost the admin's ordering.
--
--    array_agg(DISTINCT tag) guarantees uniqueness and guarantees nothing
--    about order, so ["Summer","linen"] came back as ["linen","Summer"].
--    Tag order is the order the admin typed them in and the order a
--    merchandiser expects a tag rail to read, so it is preserved explicitly:
--    group case-insensitively to find duplicates, and order the survivors by
--    the ordinal of their first appearance.
-- ==========================================================

DROP POLICY IF EXISTS "Allow public read access to products" ON public.products;

CREATE POLICY "Allow public read access to products"
    ON public.products
    FOR SELECT
    USING (
        (status = 'published' AND deleted_at IS NULL)
        OR public.is_admin()
    );

COMMENT ON POLICY "Allow public read access to products" ON public.products IS
'Two complete clauses. The first is what a shopper may read: published and '
'not retired. The second is the admin editor, which must see drafts, archived '
'and retired rows because restoring them is its job. The publishable key is '
'never an admin, so it only ever satisfies the first clause.';
