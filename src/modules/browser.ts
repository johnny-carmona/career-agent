import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { BrowserContext, Page } from "playwright";
import { server } from "../server.js";
import { buildSnapshot } from "../helpers/snapshot.js";

chromium.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROFILE_DIR = path.join(__dirname, "../../data/browser-profile");

let context: BrowserContext | null = null;
let page: Page | null = null;

function requirePage(): Page {
    if (!page) {
        throw new Error("No browser open. Call browser_open first.");
    }
    return page;
}

export function getPage(): Page | null {
    return page;
}

export async function openBrowser(url: string): Promise<string> {
    if (!context) {
        // Persistent context keeps cookies/fingerprint between sessions.
        // After solving a Cloudflare captcha once, subsequent visits are trusted.
        context = await (chromium as unknown as { launchPersistentContext: typeof chromium.launchPersistentContext })
            .launchPersistentContext(PROFILE_DIR, {
                headless: false,
                channel: "chrome",
                args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
                ignoreHTTPSErrors: true,
            });
        // Track new tabs — update `page` whenever a new tab is created
        context.on("page", (newPage) => {
            page = newPage;
        });
    }
    const pages = context.pages();
    page = pages.length > 0 ? pages[0]! : await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    return buildSnapshot(page);
}

// ── browser_open ──────────────────────────────────────────────────────────────
server.registerTool(
    "browser_open",
    {
        description: "Opens a URL in your visible Chrome browser and returns the page content and interactive elements. Call this first to read a job description or start an application.",
        inputSchema: z.object({
            url: z.string().describe("The URL to open"),
        }),
    },
    async ({ url }) => {
        try {
            const snapshot = await openBrowser(url);
            return { content: [{ type: "text", text: snapshot }] };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `browser_open failed: ${(error as Error).message}` }],
            };
        }
    }
);

// ── browser_snapshot ──────────────────────────────────────────────────────────
server.registerTool(
    "browser_snapshot",
    {
        description: "Re-captures the current page state: visible text and all interactive elements with their selectors. Use this after navigation or form changes to get the updated page.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const p = requirePage();
            const snapshot = await buildSnapshot(p);
            return { content: [{ type: "text", text: snapshot }] };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `browser_snapshot failed: ${(error as Error).message}` }],
            };
        }
    }
);

// ── browser_navigate ──────────────────────────────────────────────────────────
server.registerTool(
    "browser_navigate",
    {
        description: "Navigates the existing browser to a new URL and returns a snapshot of the resulting page.",
        inputSchema: z.object({
            url: z.string().describe("The URL to navigate to"),
        }),
    },
    async ({ url }) => {
        try {
            const p = requirePage();
            await p.goto(url, { waitUntil: "domcontentloaded" });
            const snapshot = await buildSnapshot(p);
            return { content: [{ type: "text", text: snapshot }] };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `browser_navigate failed: ${(error as Error).message}` }],
            };
        }
    }
);

// ── browser_fill ──────────────────────────────────────────────────────────────
server.registerTool(
    "browser_fill",
    {
        description: "Fills a text input or textarea with the given value. Use the selector from browser_snapshot.",
        inputSchema: z.object({
            selector: z.string().describe("CSS selector for the input or textarea element"),
            value: z.string().describe("The value to type into the field"),
        }),
    },
    async ({ selector, value }) => {
        try {
            const p = requirePage();
            await p.fill(selector, value);
            return { content: [{ type: "text", text: `Filled "${selector}" with "${value}"` }] };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `browser_fill failed: ${(error as Error).message}` }],
            };
        }
    }
);

// ── browser_select ────────────────────────────────────────────────────────────
server.registerTool(
    "browser_select",
    {
        description: "Selects an option in a <select> dropdown. Use the selector and one of the option values from browser_snapshot.",
        inputSchema: z.object({
            selector: z.string().describe("CSS selector for the <select> element"),
            value: z.string().describe("The option value to select"),
        }),
    },
    async ({ selector, value }) => {
        try {
            const p = requirePage();
            await p.selectOption(selector, value);
            return { content: [{ type: "text", text: `Selected "${value}" in "${selector}"` }] };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `browser_select failed: ${(error as Error).message}` }],
            };
        }
    }
);

// ── browser_click ─────────────────────────────────────────────────────────────
server.registerTool(
    "browser_click",
    {
        description: "Clicks an element (button, link, checkbox, radio, etc.). Use the selector from browser_snapshot. Do NOT use this to submit the final application — use browser_confirm_submit for that. Set force=true to bypass overlay/intercept issues (e.g. fixed headers blocking the click). For radio buttons and checkboxes, prefer labelText over selector — it finds the input by its visible label text and is unambiguous regardless of DOM order.",
        inputSchema: z.object({
            selector: z.string().optional().describe("CSS selector for the element to click. Optional if labelText is provided."),
            labelText: z.string().optional().describe("Exact visible label text of a radio button or checkbox to click (e.g. 'No', 'Yes', 'I Agree'). Scoped to the group identified by selector if both are provided, otherwise searches the whole page. Preferred over selector for Yes/No radio groups."),
            force: z.boolean().optional().describe("If true, bypasses visibility/overlay checks and forces the click via JS. Use when an overlay intercepts pointer events."),
        }),
    },
    async ({ selector, labelText, force }) => {
        try {
            const p = requirePage();

            if (labelText) {
                // Use getByLabel for unambiguous label-based targeting (ideal for radio/checkbox groups)
                const locator = selector
                    ? p.locator(selector).getByLabel(labelText, { exact: true })
                    : p.getByLabel(labelText, { exact: true });
                await locator.first().evaluate((el) => (el as HTMLElement).click());
                return { content: [{ type: "text", text: `Clicked label "${labelText}"${selector ? ` within "${selector}"` : ""}` }] };
            }

            if (!selector) {
                throw new Error("Either selector or labelText must be provided.");
            }

            if (force) {
                // Skip scrollIntoView (may hang on hidden elements) — go straight to JS click
                // Try the last matching element first (most likely to be the visible one)
                const count = await p.locator(selector).count();
                const idx = count > 1 ? count - 1 : 0;
                await p.locator(selector).nth(idx).evaluate((el) => (el as HTMLElement).click());
            } else {
                await p.click(selector);
            }
            return { content: [{ type: "text", text: `Clicked "${selector}"${force ? " (forced)" : ""}` }] };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `browser_click failed: ${(error as Error).message}` }],
            };
        }
    }
);

// ── browser_press_key ─────────────────────────────────────────────────────────
server.registerTool(
    "browser_press_key",
    {
        description: "Presses a keyboard key on the focused element or the page. Useful for navigating dropdowns (ArrowDown, Enter) or dismissing dialogs (Escape). Key names follow Playwright conventions: 'ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab', etc.",
        inputSchema: z.object({
            key: z.string().describe("Key name to press (e.g. 'ArrowDown', 'Enter', 'Escape', 'Tab')"),
            selector: z.string().optional().describe("CSS selector to focus before pressing. Omit to press on the currently focused element."),
        }),
    },
    async ({ key, selector }) => {
        try {
            const p = requirePage();
            if (selector) await p.focus(selector);
            await p.keyboard.press(key);
            return { content: [{ type: "text", text: `Pressed "${key}"${selector ? ` on "${selector}"` : ""}` }] };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `browser_press_key failed: ${(error as Error).message}` }],
            };
        }
    }
);

// ── browser_upload_resume ─────────────────────────────────────────────────────
server.registerTool(
    "browser_upload_resume",
    {
        description: "Uploads the generated resume PDF to a file input field. Call generate_resume_pdf first to create 'Johnny Carmona {role} Resume.pdf'. Then use the file input selector from browser_snapshot.",
        inputSchema: z.object({
            selector: z.string().describe("CSS selector for the <input type='file'> element"),
            role: z.string().describe("The job role used when generate_resume_pdf was called (e.g. 'Senior Software Engineer')"),
        }),
    },
    async ({ selector, role }) => {
        try {
            const p = requirePage();
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);
            const fileName = `Johnny Carmona ${role} Resume.pdf`;
            const filePath = path.join(__dirname, "../../data/resumes", fileName);

            // Verify the file exists before attempting upload
            const { access } = await import("fs/promises");
            await access(filePath);

            await p.setInputFiles(selector, filePath);
            return { content: [{ type: "text", text: `Uploaded "${fileName}" to "${selector}"` }] };
        } catch (error) {
            const msg = (error as Error).message;
            const hint = msg.includes("ENOENT")
                ? ` — make sure to call generate_resume_pdf("${role}") first`
                : "";
            return {
                isError: true,
                content: [{ type: "text", text: `browser_upload_resume failed: ${msg}${hint}` }],
            };
        }
    }
);

// ── indeed_update_resume ──────────────────────────────────────────────────────
server.registerTool(
    "indeed_update_resume",
    {
        description:
            "Updates the resume stored in the Indeed profile so the next 'Apply with Indeed' Easy Apply uses the tailored PDF. " +
            "Call generate_resume_pdf first, then call this before clicking 'Apply with Indeed'. " +
            "Navigates to https://my.indeed.com/profile/resume, removes any existing resume, uploads the new one, then navigates back to the job URL.",
        inputSchema: z.object({
            role: z.string().describe("The job role used when generate_resume_pdf was called (e.g. 'Senior Software Engineer'). Used to locate the PDF file."),
            returnUrl: z.string().describe("The job listing URL to navigate back to after uploading the resume."),
        }),
    },
    async ({ role, returnUrl }) => {
        try {
            const p = requirePage();
            const fileName = `Johnny Carmona ${role} Resume.pdf`;
            const filePath = path.join(__dirname, "../../data/resumes", fileName);

            // Verify the file exists first
            const { access } = await import("fs/promises");
            await access(filePath);

            // Navigate to Indeed resume management page
            await p.goto("https://my.indeed.com/profile/resume", { waitUntil: "domcontentloaded" });
            await p.waitForTimeout(2000);

            // Try to delete existing resume if present (look for delete/remove button)
            const deleteSelectors = [
                "button[aria-label*='Delete']",
                "button[aria-label*='Remove']",
                "button:has-text('Delete')",
                "button:has-text('Remove resume')",
                "[data-testid='delete-resume-button']",
            ];
            for (const sel of deleteSelectors) {
                const btn = p.locator(sel).first();
                if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
                    await btn.click();
                    // Confirm deletion if a confirmation dialog appears
                    await p.waitForTimeout(800);
                    const confirmSelectors = [
                        "button:has-text('Delete')",
                        "button:has-text('Confirm')",
                        "button:has-text('Yes')",
                    ];
                    for (const cs of confirmSelectors) {
                        const cb = p.locator(cs).first();
                        if (await cb.isVisible({ timeout: 800 }).catch(() => false)) {
                            await cb.click();
                            break;
                        }
                    }
                    await p.waitForTimeout(1000);
                    break;
                }
            }

            // Find the file input and upload (may be hidden — setInputFiles works on hidden inputs)
            const fileInput = p.locator("input[type='file']").first();
            await fileInput.waitFor({ state: "attached", timeout: 8000 });
            await fileInput.setInputFiles(filePath);
            await p.waitForTimeout(2000);

            // Navigate back to the job listing
            await p.goto(returnUrl, { waitUntil: "domcontentloaded" });
            const snapshot = await buildSnapshot(p);
            return { content: [{ type: "text", text: `Uploaded "${fileName}" to Indeed profile. Back on job page.\n\n${snapshot}` }] };
        } catch (error) {
            const msg = (error as Error).message;
            return {
                isError: true,
                content: [{ type: "text", text: `indeed_update_resume failed: ${msg}` }],
            };
        }
    }
);

// ── browser_confirm_submit ──────────────────────────────────────────────────────
server.registerTool(
    "browser_confirm_submit",
    {
        description: "FINAL STEP: Submits the job application by clicking the submit button. Only call this after all fields are filled and the human has reviewed the form in the browser. The human must explicitly approve this tool call before it executes.",
        inputSchema: z.object({
            selector: z.string().describe("CSS selector for the submit button"),
        }),
    },
    async ({ selector }) => {
        try {
            const p = requirePage();
            await p.locator(selector).first().scrollIntoViewIfNeeded();
            try {
                await p.click(selector, { timeout: 5000 });
            } catch {
                // fallback: force JS click if overlay intercepts
                await p.locator(selector).first().evaluate((el) => (el as HTMLElement).click());
            }
            return { content: [{ type: "text", text: `Application submitted via "${selector}". Watch the browser for confirmation.` }] };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `browser_confirm_submit failed: ${(error as Error).message}` }],
            };
        }
    }
);

// ── browser_close ─────────────────────────────────────────────────────────────
server.registerTool(
    "browser_close",
    {
        description: "Closes the Chrome browser window.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            if (context) {
                await context.close();
                context = null;
                page = null;
            }
            return { content: [{ type: "text", text: "Browser closed." }] };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `browser_close failed: ${(error as Error).message}` }],
            };
        }
    }
);
