-- CreateTable
CREATE TABLE "ImportRowRecord" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "importHistoryRecordId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "entityType" TEXT,
    "errorMessage" TEXT,
    "sourceRow" JSONB NOT NULL,
    "normalizedRow" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRowRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImportRowRecord_importHistoryRecordId_rowNumber_key" ON "ImportRowRecord"("importHistoryRecordId", "rowNumber");

-- CreateIndex
CREATE INDEX "ImportRowRecord_shopId_importHistoryRecordId_idx" ON "ImportRowRecord"("shopId", "importHistoryRecordId");

-- CreateIndex
CREATE INDEX "ImportRowRecord_shopId_status_idx" ON "ImportRowRecord"("shopId", "status");

-- AddForeignKey
ALTER TABLE "ImportRowRecord" ADD CONSTRAINT "ImportRowRecord_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRowRecord" ADD CONSTRAINT "ImportRowRecord_importHistoryRecordId_fkey" FOREIGN KEY ("importHistoryRecordId") REFERENCES "ImportHistoryRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
