# One-off data fixes

Scripts that correct specific rows in Capital's production data. Each one is run once, by the owner, and stays here as the record of what was changed and why. Bad data is fixed with a script like these, never with permanent structure in the schema.

Every script:

- runs in one transaction and changes nothing if any of its checks fails;
- refuses to run when the data is not in the state it was written for;
- prints the state before and after, and the exact statements that reverse the run;
- can be run twice: the second run changes nothing.

## Running one

Rehearse on a copy first. Never rehearse on `capital` or `capital_dev`.

```bash
docker exec postgres psql -U root -d postgres -c "CREATE DATABASE capital_fix_dev TEMPLATE capital_prod_dev"
```

```bash
docker exec -i postgres psql -U root -d capital_fix_dev -f - < apps/capital/scripts/data-fixes/<script>.sql
```

On production, take a backup, then apply, and keep the output: it holds the reverse statements.

```bash
ssh kodama-ai 'docker exec postgres pg_dump -U root -d capital -Fc --no-owner --no-acl' > capital-before-fix.dump
```

```bash
ssh kodama-ai 'docker exec -i postgres psql -U root -d capital -f -' < apps/capital/scripts/data-fixes/<script>.sql | tee fix-output.txt
```

To reverse, run the statements printed under "to reverse this run" inside one transaction, or restore the backup.

## Scripts

| Script | What it fixes |
|---|---|
| `2026-10-13-main-account-currency.sql` | A personal main account and its entity labelled USD while holding reais; one transfer leg written in dollars because of the label. |
