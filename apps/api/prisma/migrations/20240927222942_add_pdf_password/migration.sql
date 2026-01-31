-- AlterTable
ALTER TABLE "Email" ADD COLUMN     "pdfPassword" TEXT,
ALTER COLUMN "pdfText" DROP NOT NULL;
