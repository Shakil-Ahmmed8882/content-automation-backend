-- CreateEnum
CREATE TYPE "PlatformStatus" AS ENUM ('LIVE', 'COMING_SOON');

-- CreateTable
CREATE TABLE "platforms" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "logoPublicId" TEXT,
    "status" "PlatformStatus" NOT NULL DEFAULT 'COMING_SOON',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platforms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platforms_key_key" ON "platforms"("key");
