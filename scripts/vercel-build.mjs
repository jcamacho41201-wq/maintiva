import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (process.env.MAINTIVA_RUN_MIGRATIONS_ON_BUILD === "true") {
  run("prisma", ["migrate", "deploy"]);
}

run("prisma", ["generate"]);
run("next", ["build"]);
