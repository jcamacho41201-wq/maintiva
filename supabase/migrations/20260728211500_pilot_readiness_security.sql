-- Tighten pilot tenant management without disabling row-level security.

CREATE OR REPLACE FUNCTION public.maintiva_is_shop_owner(target_shop_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."ShopMembership" membership
    WHERE membership."shopId" = target_shop_id
      AND membership."userId" = auth.uid()::text
      AND membership."isActive" = true
      AND membership."role" IN ('OWNER', 'MANAGER')
  );
$$;

DROP POLICY IF EXISTS "Members can create shops" ON "Shop";
DROP POLICY IF EXISTS "Members can update their shops" ON "Shop";
DROP POLICY IF EXISTS "Members can delete their shops" ON "Shop";

CREATE POLICY "Authenticated users can create onboarding shops"
ON "Shop"
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Owners can update their shops"
ON "Shop"
FOR UPDATE
TO authenticated
USING (public.maintiva_is_shop_owner("id"))
WITH CHECK (public.maintiva_is_shop_owner("id"));

CREATE POLICY "Owners can delete their shops"
ON "Shop"
FOR DELETE
TO authenticated
USING (public.maintiva_is_shop_owner("id"));

DROP POLICY IF EXISTS "Users can create own active memberships" ON "ShopMembership";
DROP POLICY IF EXISTS "Members can update shop memberships" ON "ShopMembership";
DROP POLICY IF EXISTS "Members can delete shop memberships" ON "ShopMembership";

CREATE POLICY "Users can create first owner membership"
ON "ShopMembership"
FOR INSERT
TO authenticated
WITH CHECK (
  "userId" = auth.uid()::text
  AND "isActive" = true
  AND "role" = 'OWNER'
  AND NOT EXISTS (
    SELECT 1
    FROM public."ShopMembership" existing
    WHERE existing."shopId" = "ShopMembership"."shopId"
  )
);

CREATE POLICY "Owners can update shop memberships"
ON "ShopMembership"
FOR UPDATE
TO authenticated
USING (public.maintiva_is_shop_owner("shopId"))
WITH CHECK (public.maintiva_is_shop_owner("shopId"));

CREATE POLICY "Owners can delete shop memberships"
ON "ShopMembership"
FOR DELETE
TO authenticated
USING (public.maintiva_is_shop_owner("shopId"));
