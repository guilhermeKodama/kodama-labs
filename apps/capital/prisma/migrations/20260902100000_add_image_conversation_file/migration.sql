-- Images as a conversation file type: screenshots of receipts, Pix/TED
-- confirmations, card bills and broker positions, read by the agent as
-- vision input. Postgres allows ADD VALUE inside the transaction Prisma
-- wraps migrations in, as long as the new value isn't used in the same
-- transaction - it isn't here.
ALTER TYPE "StatementFileType" ADD VALUE 'image';
