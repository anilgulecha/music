// Browser test runner: drives engine/tests.html under headless Chromium so
// the Web Audio suites (render, voices, encode, jingle) run from the CLI.
// Tooling is GLOBAL per the repo charter: playwright + miniserve resolved via
// `npm root -g` — no node_modules here.
//
//   node engine/tests-browser.mjs                     run all suites
//   node engine/tests-browser.mjs --record            re-record ALL goldens
//   node engine/tests-browser.mjs --record voices     …only the named ones
//
// Live progress: each suite line streams as it finishes (testkit prints per
// test); the exit code reflects failures.
import { createRequire } from "module";
import { execSync, spawn } from "child_process";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";

const npmRoot = execSync("npm root -g").toString().trim();
const { chromium } = createRequire(import.meta.url)(npmRoot + "/playwright");

const record = process.argv.includes("--record");
const only = process.argv.filter((a, i) => i > 1 && !a.startsWith("--"));
const repo = fileURLToPath(new URL("..", import.meta.url));
const port = 18700 + ((Date.now() % 100) | 0);

const srv = spawn("miniserve", [".", "-p", String(port)], { cwd: repo, stdio: "ignore" });
try {
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("console", (m) => console.log(m.text()));
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  await page.goto(`http://localhost:${port}/engine/tests.html${record ? "?record" : ""}`);
  await page.waitForFunction(() => globalThis.__testrun, null, { timeout: 900000 });
  const run = await page.evaluate(() => globalThis.__testrun);
  if (record) {
    const goldens = await page.evaluate(() => globalThis.__goldens || {});
    for (const [name, data] of Object.entries(goldens)) {
      if (only.length && !only.includes(name)) continue;
      writeFileSync(new URL(`./${name}-golden.js`, import.meta.url),
        "// AUTO-GENERATED golden baseline. Regenerate with --record.\nexport default " +
        JSON.stringify(data, null, 1) + ";\n");
      console.log(`recorded ${name}-golden.js`);
    }
  }
  await browser.close();
  process.exitCode = run.fail ? 1 : 0;
} finally {
  srv.kill();
}
