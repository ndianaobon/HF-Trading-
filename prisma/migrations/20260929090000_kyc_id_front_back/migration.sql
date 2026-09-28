-- KYC: front and back of a government ID replace proof of address; postal code becomes optional.
ALTER TYPE "KycDocumentType" ADD VALUE IF NOT EXISTS 'GOVERNMENT_ID_BACK';

ALTER TABLE "KycApplication" ALTER COLUMN "postalCode" DROP NOT NULL;
