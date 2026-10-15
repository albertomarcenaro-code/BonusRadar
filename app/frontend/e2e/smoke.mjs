/**
 * Smoke E2E (Playwright) — esegue contro la preview già avviata su
 * http://localhost:3000 (freebuff-preview).
 *
 *   npm run test:e2e          # da app/frontend, con la preview attiva
 *   BASE_URL=... npm run test:e2e
 *
 * Le chiamate a Supabase (auth/rest/storage) vengono intercettate a livello
 * di rete: il test non tocca dati reali e non richiede credenziali.
 * Copertura: landing pubblica → login → dashboard, pagine lazy (catalogo,
 * profilo), redirect delle rotte legacy, logout e zero errori runtime.
 */
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

const USER = {
  id: "00000000-0000-4000-8000-00000000e2e2",
  aud: "authenticated",
  role: "authenticated",
  email: "e2e@bonusradar.test",
  email_confirmed_at: new Date().toISOString(),
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const SESSION = {
  access_token: "e2e-access-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: "e2e-refresh-token",
  user: USER,
};

const pageErrors = [];
const consoleErrors = [];
let passed = 0;
let failed = 0;

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const CORS = (req) => ({
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS",
  "access-control-allow-headers": req.headers()["access-control-request-headers"] || "*",
  "access-control-expose-headers": "*",
  "access-control-max-age": "86400",
});

/** Interceptor unico per tutti gli endpoint Supabase. */
async function supabaseMock(route) {
  const req = route.request();
  const url = req.url();

  if (req.method() === "OPTIONS") {
    return route.fulfill({ status: 204, headers: CORS(req) });
  }

  const headers = { ...CORS(req), "content-type": "application/json" };
  const json = (body, status = 200) => route.fulfill({ status, headers, body: JSON.stringify(body) });

  if (url.includes("/auth/v1/token")) return json(SESSION);
  if (url.includes("/auth/v1/user")) return json(USER);
  if (url.includes("/auth/v1/logout")) return json({});
  if (url.includes("/auth/v1/")) return json({}, 200);

  if (url.includes("/rest/v1/")) {
    const accept = req.headers()["accept"] ?? "";
    // maybeSingle() (profili): nessuna riga → 406, da supabase-js tradotto in null
    if (accept.includes("vnd.pgrst.object")) return route.fulfill({ status: 406, headers, body: "" });
    if (req.method() === "GET") return json([]);
    return json([]);
  }

  if (url.includes("/storage/v1/")) return json([]);

  return route.fulfill({ status: 404, headers, body: "{}" });
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.route("**/auth/v1/**", supabaseMock);
await context.route("**/rest/v1/**", supabaseMock);
await context.route("**/storage/v1/**", supabaseMock);

const page = await context.newPage();
page.on("pageerror", (err) => pageErrors.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});

try {
  console.log("\n1. Landing pubblica");
  const res = await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  check("landing raggiungibile (200)", res?.status() === 200, `status=${res?.status()}`);
  await page.getByTestId("landing-brand").waitFor({ state: "visible", timeout: 15000 });
  await page.getByTestId("landing-hero").waitFor({ state: "visible", timeout: 15000 });
  check("header + hero della landing renderizzati", true);
  check("CTA verso /auth presente", (await page.getByTestId("landing-login").count()) > 0);

  console.log("\n2. Accesso");
  await page.getByTestId("landing-login").click();
  // Predicate invece di glob: /auth arriva con ?returnTo=…
  await page.waitForURL((u) => u.pathname === "/auth", { timeout: 15000 });
  await page.getByTestId("auth-title").waitFor({ state: "visible" });
  await page.getByTestId("auth-email").fill("e2e@bonusradar.test");
  await page.getByTestId("auth-password").fill("password-e2e-1");
  await page.getByTestId("auth-submit").click();
  await page.waitForURL((u) => u.pathname === "/dashboard", { timeout: 20000 });
  await page.getByTestId("dashboard-title").waitFor({ state: "visible", timeout: 20000 });
  check("login → /dashboard con dashboard renderizzata", page.url().endsWith("/dashboard"));

  console.log("\n3. Pagine lazy (chunk separati)");
  await page.getByTestId("nav-bonus").click();
  await page.waitForURL((u) => u.pathname === "/bonus", { timeout: 15000 });
  await page
    .locator('[data-testid="bonus-list"], [data-testid="bonus-empty"]')
    .first()
    .waitFor({ state: "visible", timeout: 15000 });
  check("catalogo bonus caricato dal chunk lazy", true);

  await page.getByTestId("nav-profile").click();
  await page.waitForURL((u) => u.pathname === "/profile", { timeout: 15000 });
  await page.locator('[data-testid^="profile-section-"]').first().waitFor({ state: "visible", timeout: 15000 });
  check("profilo caricato dal chunk lazy", true);

  console.log("\n4. Rotte legacy");
  await page.goto(`${BASE_URL}/sources`, { waitUntil: "domcontentloaded" });
  await page.waitForURL((u) => u.pathname === "/dashboard", { timeout: 10000 });
  check("/sources → /dashboard", page.url().endsWith("/dashboard"), page.url());

  await page.goto(`${BASE_URL}/questionnaire`, { waitUntil: "domcontentloaded" });
  await page.waitForURL((u) => u.pathname === "/profile", { timeout: 10000 });
  check("/questionnaire → /profile", page.url().endsWith("/profile"), page.url());

  console.log("\n5. Logout");
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("dashboard-title").waitFor({ state: "visible", timeout: 15000 });
  await page.getByTestId("user-menu-button").first().click();
  await page.getByTestId("user-menu-signout").waitFor({ state: "visible" });
  await page.getByTestId("user-menu-signout").click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 15000 });
  check("logout → landing", page.url().replace(/\/$/, "") === BASE_URL, page.url());
} catch (err) {
  failed += 1;
  console.log(`  ✗ eccezione: ${err.message}`);
}

console.log("\n6. Errori runtime");
check("zero pageerror", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 500));
if (consoleErrors.length > 0) {
  console.log(`  ! console.error (${consoleErrors.length}): ${consoleErrors.slice(0, 5).join(" | ").slice(0, 400)}`);
}

await browser.close();

console.log(`\nRisultato: ${passed} ok, ${failed} falliti`);
process.exit(failed === 0 ? 0 : 1);
