import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import type { Page } from "playwright";
import { server } from "../server.js";
import { openBrowser, getPage } from "./browser.js";
import type { JobCriteria, QueuedJob, AppliedJob, ScrapedJob } from "../types/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CRITERIA_PATH = path.join(__dirname, "../../data/job_criteria.json");
const QUEUE_PATH = path.join(__dirname, "../../data/job_queue.json");
const APPLIED_PATH = path.join(__dirname, "../../data/jobs_applied.json");

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readCriteria(): Promise<JobCriteria> {
    return JSON.parse(await fs.readFile(CRITERIA_PATH, "utf-8")) as JobCriteria;
}

async function readQueue(): Promise<QueuedJob[]> {
    return JSON.parse(await fs.readFile(QUEUE_PATH, "utf-8")) as QueuedJob[];
}

async function writeQueue(queue: QueuedJob[]): Promise<void> {
    await fs.writeFile(QUEUE_PATH, JSON.stringify(queue, null, 2), "utf-8");
}

async function readApplied(): Promise<AppliedJob[]> {
    return JSON.parse(await fs.readFile(APPLIED_PATH, "utf-8")) as AppliedJob[];
}

async function writeApplied(applied: AppliedJob[]): Promise<void> {
    await fs.writeFile(APPLIED_PATH, JSON.stringify(applied, null, 2), "utf-8");
}

// ── Scraping helpers ──────────────────────────────────────────────────────────

function buildSearchUrl(
    board: string,
    query: string,
    location: string,
    isRemote: boolean,
    pageIndex: number
): string {
    if (board === "indeed") {
        const params = new URLSearchParams({ q: query, l: location, start: String(pageIndex * 15) });
        if (isRemote) params.set("remotejob", "032b3046-06a3-4876-8dfd-474eb5e7ed11");
        return `https://www.indeed.com/jobs?${params.toString()}`;
    }
    if (board === "linkedin") {
        const params = new URLSearchParams({ keywords: query, location, start: String(pageIndex * 25) });
        if (isRemote) params.set("f_WT", "2");
        return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
    }
    if (board === "glassdoor") {
        const params = new URLSearchParams({ keyword: query, locT: "N", remoteWorkType: isRemote ? "1" : "" });
        return `https://www.glassdoor.com/Job/jobs.htm?${params.toString()}`;
    }
    throw new Error(`Unknown board: ${board}`);
}

async function waitForJobCards(p: Page, board: string): Promise<void> {
    const selectorMap: Record<string, string> = {
        indeed: "h2 a[href*='jk='], h3 a[href*='jk=']",
        linkedin: ".base-card, [data-entity-urn*='jobPosting'], .job-search-card",
        glassdoor: "[data-test='jobListing'], .react-job-listing",
    };
    const selector = selectorMap[board] ?? "body";
    try {
        await p.waitForSelector(selector, { timeout: 10000 });
    } catch {
        // page loaded but no matching cards — handled in scrape step
    }
}

async function scrapeJobCards(p: Page, board: string): Promise<ScrapedJob[]> {
    return p.evaluate((boardName) => {
        const jobs: Array<{
            jobId: string; board: string; title: string;
            company: string; location: string; url: string; snippet?: string;
        }> = [];

        if (boardName === "indeed") {
            // Find job title links — they live inside h2/h3 and their href contains jk=
            // This is more reliable than data-jk which Indeed moves between layouts
            const titleLinks = [...document.querySelectorAll("h2 a[href*='jk='], h3 a[href*='jk='], h2 a[id*='jobTitle'], h3 a[id*='jobTitle']")] as HTMLAnchorElement[];
            titleLinks.forEach((a) => {
                const href = a.getAttribute("href") ?? "";
                const jkMatch = href.match(/[?&]jk=([a-f0-9]+)/i);
                const jobId = jkMatch?.[1] ?? "";
                if (!jobId) return;

                const title = (a.textContent ?? "").trim();
                if (!title) return;

                // Walk up to the card container
                const card = a.closest("li, [class*='job_seen'], [class*='tapItem'], [class*='result'], td") ?? a.parentElement;

                const companyEl = card?.querySelector(
                    "[data-testid='company-name'], [class*='companyName'], [class*='EmployerName']"
                );
                const company = (companyEl?.textContent ?? "").trim();

                const locationEl = card?.querySelector(
                    "[data-testid='text-location'], [class*='companyLocation'], [class*='locationsContainer']"
                );
                const location = (locationEl?.textContent ?? "").trim();

                const snippetEl = card?.querySelector(
                    "[class*='snippet'], [data-testid='jobDescriptionText']"
                );
                const snippet = (snippetEl?.textContent ?? "").trim().slice(0, 300);

                jobs.push({
                    jobId,
                    board: boardName,
                    title,
                    company,
                    location,
                    url: `https://www.indeed.com/viewjob?jk=${jobId}`,
                    ...(snippet ? { snippet } : {}),
                });
            });
        }

        if (boardName === "linkedin") {
            const cards = document.querySelectorAll(
                ".base-card, [data-entity-urn*='jobPosting'], .job-search-card"
            );
            cards.forEach((card) => {
                const urn = card.getAttribute("data-entity-urn") ?? "";
                const jobId = urn.split(":").pop() ?? "";

                const titleEl = card.querySelector(".base-search-card__title, h3");
                const title = (titleEl?.textContent ?? "").trim();
                if (!title) return;

                const companyEl = card.querySelector(".base-search-card__subtitle, h4");
                const company = (companyEl?.textContent ?? "").trim();

                const locationEl = card.querySelector(
                    ".job-search-card__location, .base-search-card__metadata span"
                );
                const location = (locationEl?.textContent ?? "").trim();

                const linkEl = card.querySelector("a.base-card__full-link, a[href*='/jobs/view/']");
                const url = linkEl?.getAttribute("href") ?? "";
                if (!url) return;

                jobs.push({
                    jobId: jobId || url,
                    board: boardName,
                    title,
                    company,
                    location,
                    url,
                });
            });
        }

        if (boardName === "glassdoor") {
            const cards = document.querySelectorAll(
                "[data-test='jobListing'], .react-job-listing, [class*='jobCard']"
            );
            cards.forEach((card) => {
                const linkEl = card.querySelector("a[href*='/job-listing/'], a[href*='/Jobs/']");
                const url = linkEl ? `https://www.glassdoor.com${linkEl.getAttribute("href") ?? ""}` : "";
                if (!url) return;

                const urlMatch = url.match(/[?&]jl=(\d+)|jobListingId=(\d+)/);
                const jobId = urlMatch?.[1] ?? urlMatch?.[2] ?? url;

                const titleEl = card.querySelector("[data-test='job-title'], .job-title, h2");
                const title = (titleEl?.textContent ?? "").trim();
                if (!title) return;

                const companyEl = card.querySelector("[data-test='employer-name'], .employer-name");
                const company = (companyEl?.textContent ?? "").trim();

                const locationEl = card.querySelector("[data-test='emp-location'], .location");
                const location = (locationEl?.textContent ?? "").trim();

                jobs.push({ jobId, board: boardName, title, company, location, url });
            });
        }

        return jobs;
    }, board) as Promise<ScrapedJob[]>;
}

// ── fetch_jobs ────────────────────────────────────────────────────────────────

server.registerTool(
    "fetch_jobs",
    {
        description:
            "Opens a job board in the browser, searches using the active criteria, scrapes job listings, " +
            "and adds up to maxJobs new results to the queue. Paginates automatically until the target is reached. " +
            "Supported boards: indeed, linkedin, glassdoor.",
        inputSchema: z.object({
            board: z
                .enum(["indeed", "linkedin", "glassdoor"])
                .describe("Which job board to scrape"),
            maxJobs: z
                .number()
                .optional()
                .describe("Maximum number of new jobs to add (default 20)"),
        }),
    },
    async ({ board, maxJobs = 20 }) => {
        try {
            const criteria = await readCriteria();

            const activeJobTypes = Object.entries(criteria.jobType)
                .filter(([, enabled]) => enabled)
                .map(([tag]) => tag);

            if (activeJobTypes.length === 0) {
                return {
                    isError: true,
                    content: [{ type: "text", text: "No job types enabled. Use set_job_type to enable at least one (e.g. \"full-stack\", \"software engineer\")." }],
                };
            }

            const isRemote = criteria.workType.remote;
            const location = criteria.locationKeywords[0] ?? (isRemote ? "Remote" : "");
            const query = activeJobTypes.join(" OR ");

            const queue = await readQueue();
            const existingIds = new Set(queue.map((j) => j.jobId));
            const newJobs: ScrapedJob[] = [];
            const MAX_PAGES = 5;

            for (let pageIndex = 0; pageIndex < MAX_PAGES && newJobs.length < maxJobs; pageIndex++) {
                const url = buildSearchUrl(board, query, location, isRemote, pageIndex);

                if (pageIndex === 0) {
                    await openBrowser(url);
                } else {
                    const p = getPage();
                    if (!p) break;
                    await p.goto(url, { waitUntil: "domcontentloaded" });
                }

                const p = getPage();
                if (!p) break;

                await waitForJobCards(p, board);
                const scraped = await scrapeJobCards(p, board);

                if (scraped.length === 0) break;

                for (const job of scraped) {
                    if (!existingIds.has(job.jobId) && !newJobs.find((j) => j.jobId === job.jobId)) {
                        newJobs.push(job);
                        if (newJobs.length >= maxJobs) break;
                    }
                }
            }

            for (const job of newJobs) {
                queue.push({
                    jobId: job.jobId,
                    board: job.board,
                    title: job.title,
                    company: job.company,
                    location: job.location,
                    url: job.url,
                    ...(job.snippet ? { snippet: job.snippet } : {}),
                    status: "new",
                });
            }

            await writeQueue(queue);

            const newCount = queue.filter((j) => j.status === "new").length;
            const lines = [
                `Scraped ${board} — added ${newJobs.length} new job(s) to queue.`,
                `Queue total: ${queue.length} | new: ${newCount}`,
                "",
                ...newJobs.map((j) => `  • ${j.title} @ ${j.company} (${j.location})`),
            ];

            return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `fetch_jobs failed: ${(error as Error).message}` }],
            };
        }
    }
);

// ── set_work_type ─────────────────────────────────────────────────────────────

server.registerTool(
    "set_work_type",
    {
        description:
            "Enables or disables a work arrangement filter (remote, hybrid, onsite). " +
            "Changes take effect on the next fetch_jobs call.",
        inputSchema: z.object({
            type: z
                .enum(["remote", "hybrid", "onsite"])
                .describe("The work arrangement to toggle"),
            enabled: z.boolean().describe("true to enable, false to disable"),
        }),
    },
    async ({ type, enabled }) => {
        try {
            const criteria = await readCriteria();
            criteria.workType[type] = enabled;
            await fs.writeFile(CRITERIA_PATH, JSON.stringify(criteria, null, 2), "utf-8");

            const lines = [
                `Work type updated: ${type} → ${enabled}`,
                "",
                "Current work types:",
                ...Object.entries(criteria.workType).map(
                    ([k, v]) => `  ${v ? "[ON] " : "[off]"}  ${k}`
                ),
            ];
            return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `set_work_type failed: ${(error as Error).message}` }],
            };
        }
    }
);

// ── set_job_type ──────────────────────────────────────────────────────────────

server.registerTool(
    "set_job_type",
    {
        description:
            "Adds, enables, or disables a job type keyword used in the search query. " +
            "Use natural search terms as they would appear on a job board " +
            "(e.g. \"full-stack engineer\", \"frontend developer\", \"react\", \"software engineer\"). " +
            "New keywords are created automatically. Set enabled: false to disable without removing. " +
            "Changes take effect on the next fetch_jobs call.",
        inputSchema: z.object({
            tag: z.string().describe("Job type keyword to add/enable/disable (e.g. \"full-stack engineer\", \"react developer\")"),

            enabled: z.boolean().describe("true to enable, false to disable"),
        }),
    },
    async ({ tag, enabled }) => {
        try {
            const criteria = await readCriteria();
            criteria.jobType[tag.toLowerCase()] = enabled;
            await fs.writeFile(CRITERIA_PATH, JSON.stringify(criteria, null, 2), "utf-8");

            const lines = [
                `Job type updated: "${tag}" → ${enabled}`,
                "",
                "Current job types:",
                ...Object.entries(criteria.jobType).map(
                    ([k, v]) => `  ${v ? "[ON] " : "[off]"}  ${k}`
                ),
            ];
            return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `set_job_type failed: ${(error as Error).message}` }],
            };
        }
    }
);

// ── set_location_filter ───────────────────────────────────────────────────────

server.registerTool(
    "set_location_filter",
    {
        description:
            "Adds or removes a location keyword used to filter jobs. " +
            "A job passes if its location field contains ANY active keyword (case-insensitive substring match). " +
            "If no keywords are set, all locations are accepted. " +
            "Examples: 'Worldwide', 'USA', 'US', 'anywhere', 'Canada'. " +
            "Changes take effect on the next fetch_jobs call.",
        inputSchema: z.object({
            keyword: z.string().describe("Location keyword to add or remove (e.g. 'Worldwide', 'USA', 'anywhere')"),
            enabled: z.boolean().describe("true to add the keyword, false to remove it"),
        }),
    },
    async ({ keyword, enabled }) => {
        try {
            const criteria = await readCriteria();
            const keywords: string[] = criteria.locationKeywords ?? [];
            const normalized = keyword.trim();
            const idx = keywords.findIndex((k) => k.toLowerCase() === normalized.toLowerCase());

            if (enabled && idx === -1) {
                keywords.push(normalized);
            } else if (!enabled && idx !== -1) {
                keywords.splice(idx, 1);
            }

            criteria.locationKeywords = keywords;
            await fs.writeFile(CRITERIA_PATH, JSON.stringify(criteria, null, 2), "utf-8");

            const lines = [
                keywords.length === 0
                    ? "Location filter cleared — all locations will be accepted."
                    : `Location keywords: ${keywords.map((k) => `"${k}"`).join(", ")}`,
            ];
            return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `set_location_filter failed: ${(error as Error).message}` }],
            };
        }
    }
);

// ── apply_next_job ────────────────────────────────────────────────────────────

server.registerTool(
    "apply_next_job",
    {
        description:
            "Picks the next 'new' job from the queue, marks it as processing, and opens the job listing " +
            "in the browser. Use this to start the application workflow. Follow up with browser_snapshot " +
            "to inspect the form, fill it out, then call capture_and_complete_application after submitting.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const queue = await readQueue();
            const job = queue.find((j) => j.status === "new");

            if (!job) {
                return {
                    content: [{ type: "text", text: "No new jobs in the queue. Call fetch_jobs to add more." }],
                };
            }

            job.status = "processing";
            await writeQueue(queue);

            const snapshot = await openBrowser(job.url);

            const info = [
                `Now applying to: ${job.title} at ${job.company}`,
                `Board: ${job.board}`,
                `Location: ${job.location}`,
                `URL: ${job.url}`,
                ...(job.snippet ? [`Preview: ${job.snippet}`] : []),
                "",
                "--- Page Snapshot ---",
                snapshot,
            ].join("\n");

            return { content: [{ type: "text", text: info }] };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `apply_next_job failed: ${(error as Error).message}` }],
            };
        }
    }
);

// ── capture_and_complete_application ─────────────────────────────────────────

server.registerTool(
    "capture_and_complete_application",
    {
        description:
            "Call this after browser_confirm_submit to record the completed application. " +
            "Automatically captures all filled form fields on the current page as Q&A pairs. " +
            "Saves the application to jobs_applied.json and removes the job from the active queue.",
        inputSchema: z.object({
            jobDescription: z.string().describe("The full job description text copied from the listing"),
            companyUrl: z.string().describe("The company's main website URL (not the job listing URL)"),
            questionsAndAnswers: z.array(z.object({
                question: z.string(),
                answer: z.string(),
            })).optional().describe("Q&A pairs from screener/application questions. Pass these explicitly since the page may have navigated away after submit."),
        }),
    },
    async ({ jobDescription, companyUrl, questionsAndAnswers: providedQA }) => {
        try {
            const queue = await readQueue();
            const jobIdx = queue.findIndex((j) => j.status === "processing");

            if (jobIdx === -1) {
                return {
                    isError: true,
                    content: [{ type: "text", text: "No job is currently processing. Call apply_next_job first." }],
                };
            }

            const job = queue[jobIdx]!;

            // Use explicitly provided Q&A if given; otherwise try to scrape from live page
            const p = getPage();
            let questionsAndAnswers: { question: string; answer: string }[] = providedQA ?? [];

            if (!providedQA && p) {
                questionsAndAnswers = await p.evaluate(() => {
                    const results: { question: string; answer: string }[] = [];

                    function labelFor(el: Element): string {
                        const id = el.getAttribute("id");
                        if (id) {
                            const label = document.querySelector(`label[for="${id}"]`);
                            if (label) return (label as HTMLElement).innerText.trim();
                        }
                        const closestLabel = el.closest("label");
                        if (closestLabel) return (closestLabel as HTMLElement).innerText.trim();
                        const ariaLabel = el.getAttribute("aria-label");
                        if (ariaLabel) return ariaLabel.trim();
                        const placeholder = el.getAttribute("placeholder");
                        if (placeholder) return placeholder.trim();
                        return "";
                    }

                    document.querySelectorAll("input, textarea").forEach((el) => {
                        const input = el as HTMLInputElement | HTMLTextAreaElement;
                        const type = input.getAttribute("type") ?? "text";
                        if (["hidden", "submit", "reset", "image", "file", "checkbox", "radio"].includes(type)) return;
                        const value = input.value?.trim();
                        if (!value) return;
                        const question = labelFor(el);
                        if (question) results.push({ question, answer: value });
                    });

                    document.querySelectorAll("select").forEach((el) => {
                        const select = el as HTMLSelectElement;
                        const value = select.options[select.selectedIndex]?.text?.trim();
                        if (!value) return;
                        const question = labelFor(el);
                        if (question) results.push({ question, answer: value });
                    });

                    return results;
                });
            }

            const applied: AppliedJob = {
                jobId: job.jobId,
                board: job.board,
                title: job.title,
                company: job.company,
                companyUrl,
                jobDescription,
                url: job.url,
                questionsAndAnswers,
                appliedAt: new Date().toISOString(),
            };

            const appliedList = await readApplied();
            appliedList.push(applied);
            await writeApplied(appliedList);

            // Remove from active queue
            queue.splice(jobIdx, 1);
            await writeQueue(queue);

            return {
                content: [
                    {
                        type: "text",
                        text: [
                            `Application recorded: ${job.title} at ${job.company}`,
                            `Captured ${questionsAndAnswers.length} Q&A pair(s).`,
                            `Total applications logged: ${appliedList.length}`,
                        ].join("\n"),
                    },
                ],
            };
        } catch (error) {
            return {
                isError: true,
                content: [
                    { type: "text", text: `capture_and_complete_application failed: ${(error as Error).message}` },
                ],
            };
        }
    }
);

// ── skip_current_job ──────────────────────────────────────────────────────────

server.registerTool(
    "skip_current_job",
    {
        description:
            "Marks the currently processing job as skipped without recording an application. " +
            "Use this if the job isn't a good fit or the form is too complex.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const queue = await readQueue();
            const job = queue.find((j) => j.status === "processing");

            if (!job) {
                return { content: [{ type: "text", text: "No job is currently processing." }] };
            }

            job.status = "skipped";
            await writeQueue(queue);

            return { content: [{ type: "text", text: `Skipped: ${job.title} at ${job.company}` }] };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `skip_current_job failed: ${(error as Error).message}` }],
            };
        }
    }
);

// ── get_job_queue ─────────────────────────────────────────────────────────────

server.registerTool(
    "get_job_queue",
    {
        description: "Returns all jobs in the queue with a summary of counts by status (new / processing / skipped).",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const queue = await readQueue();
            const counts = { new: 0, processing: 0, skipped: 0 };
            for (const job of queue) counts[job.status]++;

            const lines = [
                `Queue: ${counts.new} new | ${counts.processing} processing | ${counts.skipped} skipped`,
                "",
                ...queue.map(
                    (j) => `[${j.status.toUpperCase().padEnd(10)}] ${j.title} @ ${j.company}  (${j.board})  ${j.url}`
                ),
            ];

            return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `get_job_queue failed: ${(error as Error).message}` }],
            };
        }
    }
);
