-- Removes the pre-ledger tables that 20261004200200_ledger_v2_retire_legacy
-- moved into the `legacy` schema (plus legacy.id_map, the old -> new id
-- correspondence, and the link archives attachment_links, budget_links and
-- reminder_dispatch_links). Run once the ledger has been in use long enough
-- that nobody needs to look at the old rows; take a pg_dump first.
DROP SCHEMA IF EXISTS legacy CASCADE;
