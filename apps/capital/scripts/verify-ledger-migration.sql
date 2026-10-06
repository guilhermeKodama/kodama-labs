-- Read-only checks that the ledger_v2 migrations carried every pre-ledger
-- row over intact. The old tables stay in the `legacy` schema until
-- db:drop-legacy, so this compares the two directly; run it right after
-- `prisma migrate deploy`, before anyone writes through the new UI.
--
--   docker exec -i postgres sh -c 'psql -U "$POSTGRES_USER" -d <db>' \
--     < apps/capital/scripts/verify-ledger-migration.sql
--
-- Expected: every "unmapped" count is 0, every legacy/ledger pair is equal,
-- and "unbalanced transfer groups" is 0. Legacy expenses that were credit
-- card bill payments become card_payment transfers (the purchases already
-- live on the card), so section 5 reports them separately and section 4
-- compares only the rest. Bill-only purchases whose bill payment is already
-- a statement settlement are not ledger expenses (section 3b); section 3
-- compares the purchases that were inserted.

\echo '== 1. Row counts'
select 'legacy.transactions' as source, count(*) from legacy.transactions
union all select 'legacy.bill_transactions', count(*) from legacy.bill_transactions
union all select 'legacy.transfers', count(*) from legacy.transfers
union all select 'legacy.investment_transactions', count(*) from legacy.investment_transactions
union all select 'ledger_entries', count(*) from ledger_entries
union all select 'transfer_groups', count(*) from transfer_groups
union all select 'investment_operations', count(*) from investment_operations;

\echo '== 2. Unmapped legacy rows (all must be 0)'
select 'transactions' as source, count(*) from legacy.transactions t
  where not exists (select 1 from legacy.id_map m where m.old_id = t.id)
union all select 'bill_transactions', count(*) from legacy.bill_transactions t
  where not exists (select 1 from legacy.id_map m where m.old_id = t.id)
union all select 'transfers', count(*) from legacy.transfers t
  where not exists (select 1 from legacy.id_map m where m.old_id = t.id)
union all select 'investment_transactions', count(*) from legacy.investment_transactions t
  where not exists (select 1 from legacy.id_map m where m.old_id = t.id);

\echo '== 3. Card purchases that became ledger expenses (legacy = ledger)'
\echo 'Section 3c of the precheck is excluded. See section 3b.'
select
  (select count(*) from legacy.bill_transactions bt
    where not exists (
      select 1 from legacy.id_map m
      where m.old_id = bt.id and m.old_model = 'BillTransaction' and m.new_model = 'SupersededBillPurchase'
    )) as legacy_n,
  (select round(sum(abs(bt.amount))::numeric, 2) from legacy.bill_transactions bt
    where not exists (
      select 1 from legacy.id_map m
      where m.old_id = bt.id and m.old_model = 'BillTransaction' and m.new_model = 'SupersededBillPurchase'
    )) as legacy_sum,
  (select count(*) from ledger_entries e
     join legacy.id_map m on m.new_id = e.id and m.old_model = 'BillTransaction'
     and m.new_model = 'LedgerEntry') as ledger_n,
  (select round(sum(abs(e.amount))::numeric, 2) from ledger_entries e
     join legacy.id_map m on m.new_id = e.id and m.old_model = 'BillTransaction'
     and m.new_model = 'LedgerEntry') as ledger_sum;

\echo '== 3b. Bill purchases skipped because the bill payment is also a statement settlement'
\echo 'skipped_n and skipped_abs_sum must match precheck section 3c. inserted_as_expense must be 0.'
select
  (select count(*) from legacy.id_map m
    where m.old_model = 'BillTransaction' and m.new_model = 'SupersededBillPurchase') as skipped_n,
  (select round(coalesce(sum(abs(bt.amount)), 0)::numeric, 2)
    from legacy.bill_transactions bt
    join legacy.id_map m on m.old_id = bt.id and m.old_model = 'BillTransaction' and m.new_model = 'SupersededBillPurchase') as skipped_abs_sum,
  (select count(*) from legacy.id_map m
    join ledger_entries e on e.id = m.old_id and e.kind = 'expense'
    where m.old_model = 'BillTransaction' and m.new_model = 'SupersededBillPurchase') as inserted_as_expense;

\echo '== 4. Income/expense per user, excluding bill payments (legacy = ledger)'
with legacy_tx as (
  select coalesce(b."userId", p."userId") as user_id, t.type::text as type,
         t.amount * coalesce(t."exchangeRate", 1) as amount, t.id
  from legacy.transactions t
  left join legacy.businesses b on b.id = t."businessId"
  left join legacy.personal_accounts p on p.id = t."personalAccountId"
  where not exists (select 1 from legacy.id_map x where x.old_id = t.id and x.new_model = 'TransferGroup')
)
select l.user_id, l.type,
       round(sum(l.amount)::numeric, 2) as legacy_sum,
       round(sum(abs(e."amountBase"))::numeric, 2) as ledger_sum,
       count(*) as n
from legacy_tx l
join legacy.id_map m on m.old_id = l.id and m.new_model = 'LedgerEntry'
join ledger_entries e on e.id = m.new_id
group by 1, 2 order by 1, 2;

\echo '== 5. Bill payments converted to card_payment transfers (informational)'
select coalesce(b."userId", p."userId") as user_id, count(*),
       round(sum(t.amount * coalesce(t."exchangeRate", 1))::numeric, 2) as amount
from legacy.transactions t
join legacy.id_map m on m.old_id = t.id and m.new_model = 'TransferGroup'
left join legacy.businesses b on b.id = t."businessId"
left join legacy.personal_accounts p on p.id = t."personalAccountId"
group by 1 order by 1;

\echo '== 6. Transfers: legacy count vs ledger legs (legs = 2 x legacy)'
select (select count(*) from legacy.transfers) as legacy_transfers,
       (select count(*) from ledger_entries e
          join legacy.id_map m on m.new_id = e.id and m.old_model = 'Transfer'
          and m.new_model = 'LedgerEntry') as ledger_legs;

\echo '== 7. Unbalanced transfer groups (must be 0)'
select count(*) from (
  select "transferGroupId" from ledger_entries
  where "transferGroupId" is not null and "deletedAt" is null
  group by 1 having count(*) <> 2
) x;

\echo '== 8. Archived link columns (archived count must equal the live count)'
select 'attachments' as source,
       (select count(*) from attachments) as live,
       (select count(*) from legacy.attachment_links) as archived
union all
select 'budgets',
       (select count(*) from budgets),
       (select count(*) from legacy.budget_links)
union all
select 'reminder_dispatches',
       (select count(*) from reminder_dispatches),
       (select count(*) from legacy.reminder_dispatch_links);

\echo '== 9. Business brokerages mapped onto the personal entity (informational)'
select ia.id, ia."userId", ia.name, a."entityId" as personal_entity_id
from legacy.investment_accounts ia
join accounts a on a.id = ia.id
join entities e on e.id = a."entityId" and e.kind = 'personal'
where ia."businessId" is null
  and ia."personalAccountId" is null
  and ia."entityType" = 'business'
order by ia.id;
