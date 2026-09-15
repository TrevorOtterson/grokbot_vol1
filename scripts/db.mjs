#!/usr/bin/env node
/**
 * Picks Prisma schema by DATABASE_URL:
 *   postgres/postgresql → prisma/schema.prisma (Fly / production)
 *   otherwise           → prisma/sqlite/schema.prisma (local demo)
 *
 * Commands: generate | migrate | deploy | setup
 *   deploy = generate + migrate (Docker boot; no seed)
 *   setup  = generate + migrate + seed (local / demo)
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] || "setup";

const PLACEHOLDER_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:5432/receivekit?schema=public";

function isPostgres(url = process.env.DATABASE_URL || "") {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

function schemaPath() {
  return isPostgres()
    ? path.join(root, "prisma/schema.prisma")
    : path.join(root, "prisma/sqlite/schema.prisma");
}

function prismaBin() {
  return path.join(root, "node_modules/.bin/prisma");
}

function runPrisma(args) {
  const env = { ...process.env };
  if (isPostgres() && !env.DATABASE_URL) {
    env.DATABASE_URL = PLACEHOLDER_DATABASE_URL;
  }
  const result = spawnSync(prismaBin(), [...args, "--schema", schemaPath()], {
    stdio: "inherit",
    env,
    cwd: root,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function generate() {
  runPrisma(["generate"]);
}

function migrate() {
  if (isPostgres() && !process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is required for Postgres `prisma migrate deploy` (Fly postgres attach).",
    );
    process.exit(1);
  }
  runPrisma(["migrate", "deploy"]);
}

function seed() {
  const tsx = path.join(root, "node_modules/.bin/tsx");
  const result = spawnSync(tsx, ["prisma/seed.ts"], {
    stdio: "inherit",
    env: process.env,
    cwd: root,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

switch (command) {
  case "generate":
    generate();
    break;
  case "migrate":
    migrate();
    break;
  case "deploy":
    generate();
    migrate();
    break;
  case "setup":
    generate();
    migrate();
    seed();
    break;
  default:
    console.error(`Unknown db command: ${command}`);
    process.exit(1);
}
