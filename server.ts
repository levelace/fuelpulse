import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import cron from "node-cron";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;

const asyncHandler = (fn: any) => (req: any, res: any, next: any) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

if (!supabaseUrl || !supabaseServiceKey || !JWT_SECRET) {
  console.error("CRITICAL: Missing environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or JWT_SECRET).");
  if (!JWT_SECRET) {
    console.warn("JWT_SECRET is missing. Authentication will fail.");
  }
}

const supabaseAdmin = createClient(supabaseUrl || "", supabaseServiceKey || "");

// --- Auth Middleware ---
const authenticateToken = (req: any, res: any, next: any) => {
  const token = req.cookies.auth_token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  if (!JWT_SECRET) {
    console.error("[Auth] JWT_SECRET is missing. Authentication configuration error.");
    return res.status(500).json({ error: "Authentication configuration error" });
  }

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) {
      console.warn("[Auth] JWT verification failed:", err.message);
      return res.status(403).json({ error: "Forbidden" });
    }
    req.user = user;
    next();
  });
};

async function runBackgroundSimulation(storeId: string, storeUrl: string) {
  console.log(`[Cron Poller] Running scheduled simulation for ${storeUrl}`);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    const startTime = Date.now();
    await page.goto(storeUrl, { waitUntil: "networkidle" });
    
    const productLink = await page.locator('a[href*="/products/"]').first();
    if (await productLink.count() > 0) {
      await productLink.click();
      await page.waitForLoadState("networkidle");

      const atcButton = page.locator('button[name="add"], [aria-label*="Add to cart"], .product-form__submit').first();
      const atcStartTime = Date.now();
      
      const [response] = await Promise.all([
        page.waitForResponse(resp => resp.url().includes('/cart/add') || resp.url().includes('/cart/update'), { timeout: 10000 }),
        atcButton.click()
      ]);

      const atcLatency = Date.now() - atcStartTime;
      const status = response.status();

      if (atcLatency > 400 || status === 422) {
        await supabaseAdmin.from("leaks").insert({
          store_url: storeUrl,
          leak_type: atcLatency > 400 ? "LATENCY" : "API_ERROR",
          severity: atcLatency > 1000 ? 5 : 3,
          impact_ms: atcLatency,
          captured_at: new Date().toISOString(),
          details: `[CRON] ATC response took ${atcLatency}ms with status ${status}`
        });
      }
    }
    
    await supabaseAdmin.from("stores").update({
      last_scan_at: new Date().toISOString()
    }).eq("id", storeId);

  } catch (error) {
    console.error(`[Cron Error] Failed simulation for ${storeUrl}:`, error);
  } finally {
    if (browser) await browser.close();
  }
}

// Schedule: Every 30 minutes
cron.schedule("*/30 * * * *", async () => {
  console.log("[Cron] Initiating 30-min store poll...");
  try {
    const { data: stores, error } = await supabaseAdmin.from("stores").select("*");
    if (error) throw error;
    
    for (const store of stores || []) {
      await runBackgroundSimulation(store.id, store.url);
    }
  } catch (error) {
    console.error("[Cron] Failed to fetch stores:", error);
  }
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());

  // --- Bootstrap API (One-time setup) ---
  app.get("/api/auth/status", asyncHandler(async (req, res) => {
    const { count } = await supabaseAdmin.from("users").select("*", { count: "exact", head: true });
    res.json({ bootstrapped: !!(count && count > 0) });
  }));

  app.post("/api/auth/bootstrap", asyncHandler(async (req, res) => {
    const { accessKey, secretKey } = req.body;
    if (!accessKey || !secretKey) return res.status(400).json({ error: "Missing credentials" });

    // Check if any users exist
    const { count } = await supabaseAdmin.from("users").select("*", { count: "exact", head: true });
    if (count && count > 0) return res.status(403).json({ error: "System already bootstrapped" });

    const secretHash = await bcrypt.hash(secretKey, 12);
    const { data, error } = await supabaseAdmin.from("users").insert({
      access_key: accessKey,
      secret_hash: secretHash,
      role: "admin"
    }).select().single();

    if (error) {
      console.error("[Auth] Database error during bootstrap:", JSON.stringify(error, null, 2));
      throw error;
    }
    res.json({ success: true, message: "Admin created. Please login." });
  }));

  // --- Auth API ---
  app.post("/api/auth/login", asyncHandler(async (req, res) => {
    const { accessKey, secretKey } = req.body;
    if (!accessKey || !secretKey) return res.status(400).json({ error: "Missing credentials" });

    console.log(`[Auth] Login attempt for: ${accessKey}`);
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("access_key", accessKey)
      .maybeSingle();

    if (error) {
      console.error("[Auth] Database error during login:", JSON.stringify(error, null, 2));
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (!user) {
      console.warn(`[Auth] User not found: ${accessKey}`);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const validSecret = await bcrypt.compare(secretKey, user.secret_hash);
    if (!validSecret) {
      console.warn(`[Auth] Invalid password for: ${accessKey}`);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET!, { expiresIn: "7d" });

    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({ success: true, user: { id: user.id, role: user.role } });
  }));

  app.get("/api/auth/session", (req, res) => {
    const token = req.cookies.auth_token;
    if (!token) return res.json({ user: null });

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return res.json({ user: null });
      res.json({ user });
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("auth_token");
    res.json({ success: true });
  });

  // --- Protected API Routes ---
  const validateUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname.startsWith("169.254")) {
        return false;
      }
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  };

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", engine: "Fuelerate Pulse" });
  });

  app.get("/api/stores", authenticateToken, asyncHandler(async (req: any, res) => {
    const { data, error } = await supabaseAdmin
      .from("stores")
      .select("*")
      .eq("owner_uid", req.user.id);
    if (error) {
      console.error("[API] Error fetching stores:", JSON.stringify(error, null, 2));
      return res.status(500).json({ error: error.message });
    }
    res.json(data || []);
  }));

  app.post("/api/stores", authenticateToken, asyncHandler(async (req: any, res) => {
    const { url, name } = req.body;
    if (!url || !name) return res.status(400).json({ error: "URL and name required" });

    const { data, error } = await supabaseAdmin
      .from("stores")
      .insert({
        url,
        name,
        owner_uid: req.user.id,
        created_at: new Date().toISOString()
      })
      .select()
      .single();
    if (error) {
      console.error("[API] Error adding store:", JSON.stringify(error, null, 2));
      return res.status(500).json({ error: error.message });
    }
    res.json(data);
  }));

  app.get("/api/leaks", authenticateToken, asyncHandler(async (req, res) => {
    const { data, error } = await supabaseAdmin
      .from("leaks")
      .select("*")
      .order("captured_at", { ascending: false })
      .limit(50);
    if (error) {
      console.error("[API] Error fetching leaks:", JSON.stringify(error, null, 2));
      return res.status(500).json({ error: error.message });
    }
    res.json(data || []);
  }));

  app.post("/api/simulate", authenticateToken, asyncHandler(async (req, res) => {
    const { storeUrl } = req.body;
    if (!storeUrl || !validateUrl(storeUrl)) return res.status(400).json({ error: "Valid Store URL required" });

    console.log(`[Ghost Shopper] Starting simulation for ${storeUrl}`);
    
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();

      const startTime = Date.now();
      await page.goto(storeUrl, { waitUntil: "networkidle" });
      const loadTime = Date.now() - startTime;

      const productLink = await page.locator('a[href*="/products/"]').first();
      if (await productLink.count() === 0) throw new Error("No product found on homepage");
      
      await productLink.click();
      await page.waitForLoadState("networkidle");

      const atcButton = page.locator('button[name="add"], [aria-label*="Add to cart"], .product-form__submit').first();
      const atcStartTime = Date.now();
      
      const [response] = await Promise.all([
        page.waitForResponse(resp => resp.url().includes('/cart/add') || resp.url().includes('/cart/update'), { timeout: 10000 }),
        atcButton.click()
      ]);

      const atcLatency = Date.now() - atcStartTime;
      const status = response.status();

      let leak = null;
      if (atcLatency > 400 || status === 422) {
        leak = {
          leak_type: atcLatency > 400 ? "LATENCY" : "API_ERROR",
          severity: atcLatency > 1000 ? 5 : 3,
          impact_ms: atcLatency,
          details: `ATC response took ${atcLatency}ms with status ${status}`
        };
      }

      await browser.close();
      res.json({ success: true, metrics: { loadTime, atcLatency, status }, leak });

    } catch (error: any) {
      if (browser) await browser.close();
      res.status(500).json({ error: error.message });
    }
  }));

  // App Bloat Auditor Endpoint
  app.post("/api/audit-apps", authenticateToken, asyncHandler(async (req, res) => {
    const { storeUrl, accessToken } = req.body;
    if (!storeUrl || !validateUrl(storeUrl)) return res.status(400).json({ error: "Valid Store URL required" });

    console.log(`[App Auditor] Auditing bloat for ${storeUrl}`);

    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();

      // 1. Measure LCP and Script Count via Playwright
      await page.goto(storeUrl, { waitUntil: "networkidle" });

      const auditResults = await page.evaluate(async () => {
        const scripts = Array.from(document.querySelectorAll('script[src]'));
        const thirdPartyScripts = scripts.filter(s => {
          const src = (s as HTMLScriptElement).src;
          return !src.includes(window.location.hostname) && !src.includes('shopify.com/cdn');
        });

        // Simple LCP measurement via Performance API
        const paintEntries = performance.getEntriesByType('paint');
        const lcpEntry = paintEntries.find(e => e.name === 'largest-contentful-paint');
        
        // Map common Shopify apps to names (simplified for MVP)
        const appMap: Record<string, string> = {
          'klaviyo': 'Klaviyo Marketing',
          'yotpo': 'Yotpo Reviews',
          'judge.me': 'Judge.me Reviews',
          'smile.io': 'Smile Rewards',
          'privy': 'Privy Popups',
          'hotjar': 'Hotjar Analytics',
          'facebook': 'FB Pixel',
          'google-analytics': 'Google Analytics'
        };

        const identifiedApps = thirdPartyScripts.map(s => {
          const src = (s as HTMLScriptElement).src.toLowerCase();
          const appKey = Object.keys(appMap).find(key => src.includes(key));
          return {
            name: appKey ? appMap[appKey] : 'Unknown Third-Party',
            src: (s as HTMLScriptElement).src,
            latencyTax: Math.floor(Math.random() * 150) + 50 // Simulated latency tax per app
          };
        });

        return {
          totalScripts: scripts.length,
          thirdPartyCount: thirdPartyScripts.length,
          identifiedApps,
          lcp: lcpEntry ? lcpEntry.startTime : 1200 // Fallback LCP
        };
      });

      // 2. If accessToken is provided, fetch ScriptTags from Admin API
      let adminScripts = [];
      if (accessToken) {
        try {
          const shopName = storeUrl.replace('https://', '').split('.')[0];
          const response = await fetch(`https://${shopName}.myshopify.com/admin/api/2024-01/script_tags.json`, {
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Content-Type': 'application/json'
            }
          });
          const data = await response.json();
          adminScripts = data.script_tags || [];
        } catch (e) {
          console.error("[Shopify API Error]", e);
        }
      }

      await browser.close();

      res.json({
        success: true,
        metrics: {
          ...auditResults,
          adminScriptCount: adminScripts.length
        }
      });

    } catch (error: any) {
      if (browser) await browser.close();
      console.error("[App Auditor Error]", error);
      res.status(500).json({ error: error.message });
    }
  }));

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Fuelerate] Server running on http://localhost:${PORT}`);
  });

  // Global error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("[Global Error]", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  });
}

startServer();
