-- Arabic-aware search: one spelling for the forms people type the same name
-- in. Lower-cases, drops tashkeel (U+064B..U+0652), tatweel (U+0640) and the
-- dagger alef (U+0670), and folds أ إ آ ٱ to ا, ى to ي and ة to ه.
-- Mirrors foldArabic() in packages/shared/src/utils/arabic-fold.ts.
-- Prisma doesn't track functions, so this needs nothing in schema.prisma.
CREATE OR REPLACE FUNCTION ar_fold(t text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT translate(
    regexp_replace(lower(t), '[ً-ْـٰ]', '', 'g'),
    U&'\0623\0625\0622\0671\0649\0629',
    U&'\0627\0627\0627\0627\064A\0647'
  )
$$;
