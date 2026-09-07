import "dotenv/config";
import { defineConfig } from "prisma/config";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL || process.env.PRISMA_DATABASE_URL || "";
}
if (/^prisma(\+postgres)?:\/\//i.test(process.env.DATABASE_URL || "")) {
  process.env.DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
}
if (!process.env.DIRECT_URL) {
  const fallback = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL_UNPOOLED || "";
  process.env.DIRECT_URL = /^(postgres|postgresql):\/\//i.test(fallback) ? fallback : "";
}

export default defineConfig({
  schema: "prisma/schema.prisma",
});
