import { defineConfig, env } from "prisma/config";
import { config as loadEnv } from "dotenv";

loadEnv({ path: "./prisma/.env" });

export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    provider: "postgresql",
    url: env("DATABASE_URL")
  }
});
