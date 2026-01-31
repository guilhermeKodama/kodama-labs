-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_parentId_fkey";

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
