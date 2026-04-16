import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { server } from "../server.js";
import { buildSnapshot } from "../helpers/snapshot.js";

let browser: Browser | null = null;
let page: Page | null = null;

function requirePage(): Page {
    if (!page) {
        throw new Error("No browser open. Call browser_open first.");
    }
    return page;
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
            if (browser) {
                await browser.close();
            }
            browser = await chromium.launch({ headless: false, channel: "chrome" });
            page = await browser.newPage();
            await page.goto(url, { waitUntil: "domcontentloaded" });
            const snapshot = await buildSnapshot(page);
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
        description: "Clicks an element (button, link, checkbox, radio, etc.). Use the selector from browser_snapshot. Do NOT use this to submit the final application — use browser_confirm_submit for that.",
        inputSchema: z.object({
            selector: z.string().describe("CSS selector for the element to click"),
        }),
    },
    async ({ selector }) => {
        try {
            const p = requirePage();
            await p.click(selector);
            return { content: [{ type: "text", text: `Clicked "${selector}"` }] };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `browser_click failed: ${(error as Error).message}` }],
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
            await p.click(selector);
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
            if (browser) {
                await browser.close();
                browser = null;
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
