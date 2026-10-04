-- Hide a category from pickers without deleting it.
-- NOT NULL DEFAULT false is a constant default: existing rows become false
-- with no table rewrite and no backfill.
ALTER TABLE "categories" ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false;
