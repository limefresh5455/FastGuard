const DDL = [
  `CREATE TABLE IF NOT EXISTS "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "companyType" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "website" TEXT,
    "phone" TEXT,
    "city" TEXT,
    "state" TEXT,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "Company_normalizedName_idx" ON "Company"("normalizedName")`,
  `CREATE TABLE IF NOT EXISTS "Contact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "Contact_companyId_idx" ON "Contact"("companyId")`,
  `CREATE TABLE IF NOT EXISTS "Project" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "projectType" TEXT,
    "projectStage" TEXT,
    "projectValue" DOUBLE PRECISION,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "TriggerEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "projectId" TEXT,
    "triggerType" TEXT NOT NULL,
    "triggerDate" TIMESTAMP(3) NOT NULL,
    "headline" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TriggerEvent_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "Lead" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "projectId" TEXT,
    "triggerId" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "recommendedService" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "classified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "Lead_score_idx" ON "Lead"("score")`,
  `CREATE INDEX IF NOT EXISTS "Lead_source_idx" ON "Lead"("source")`,
  `CREATE TABLE IF NOT EXISTS "sources" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "recordsCreated" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "sources_code_key" ON "sources"("code")`,
];

export async function ensureSchema(prisma: {
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
}) {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "Lead" LIMIT 1`;
    return;
  } catch {
    for (const sql of DDL) {
      await prisma.$executeRawUnsafe(sql);
    }
  }
}
