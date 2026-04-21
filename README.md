# career-agent

An MCP (Model Context Protocol) server that automates job applications. It scrapes job boards, generates tailored resume PDFs, fills out application forms with a real Chrome browser, and logs completed applications — all driven by an AI assistant (Cline, Claude, etc.).

## How It Works

The server exposes a set of tools that an AI agent calls in sequence:

1. Configure search criteria (job types, location, work arrangement)
2. Scrape job listings from Indeed / LinkedIn / Glassdoor into a queue
3. For each job: review → generate tailored resume PDF → open application form → fill fields → upload resume → review → submit
4. Log completed applications to `data/jobs_applied.json`

The browser uses a persistent Chrome profile (`data/browser-profile/`) so cookies, logins, and Cloudflare trust carry over between sessions.

---

## Setup

### 1. Install dependencies

```bash
yarn install
```

### 2. Build

```bash
yarn build
```

### 4. Configure your data files

Create the following files in the `data/` directory (none are committed — they're gitignored):

**`data/resume.md`** — Your master resume in Markdown. This is the source of truth for all generated PDFs. Contact info (name, email, phone, LinkedIn) is auto-injected into every PDF from this file.

**`data/extra_context.json`** — A JSON array of engineering stories, technical challenges, and project details to draw from when answering open-ended application questions. Example structure:

```json
[
  {
    "title": "Performance Fix: Angular Virtual Scroll",
    "summary": "...",
    "details": "..."
  }
]
```

**`data/job_criteria.json`** — Search configuration. You can create this manually or let the `set_job_type` / `set_work_type` / `set_location_filter` tools generate it. Example:

```json
{
  "jobType": {
    "senior full stack engineer": true,
    "senior frontend engineer": true
  },
  "workType": {
    "remote": true,
    "hybrid": true,
    "onsite": false
  },
  "locationKeywords": ["New York", "Remote"]
}
```

**`data/job_queue.json`** — Job queue, managed automatically. Initialize as an empty array:

```json
[]
```

**`data/jobs_applied.json`** — Application log, managed automatically. Initialize as an empty array:

```json
[]
```

### 5. Register with your AI client

Add the server to your MCP client config (e.g. Cline, Claude Desktop). Example for `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "career-agent": {
      "command": "node",
      "args": ["/absolute/path/to/career-agent/build/index.js"],
      "disabled": false
    }
  }
}
```

**Important:** Restart the MCP server after every `yarn build`.

---

## Tool Reference

### Resume & Context

| Tool | Description |
|---|---|
| `read_resume` | Reads `data/resume.md` and returns its full text. Call before generating any PDF or answering application questions. |
| `read_extra_context` | Reads `data/extra_context.json` — real project stories and technical challenges to use in open-ended answers. |

### PDF Generation

| Tool | Description |
|---|---|
| `generate_resume_pdf` | Generates a tailored resume PDF from Markdown content. Saves to `data/resumes/Johnny Carmona {role} Resume.pdf`. Do NOT include contact info — it is auto-injected from `resume.md`. |
| `generate_letter` | Generates a cover letter PDF from plain text. Saves to `data/cover_letters/{role}-{company}-johnny-carmona.pdf`. |

### Job Search

| Tool | Description |
|---|---|
| `fetch_jobs` | Scrapes a job board (`indeed`, `linkedin`, `glassdoor`) using active criteria and adds new listings to the queue. |
| `get_job_queue` | Returns all queued jobs with status counts (new / processing / skipped / applied). |
| `set_job_type` | Adds or enables/disables a job type keyword (e.g. `"senior frontend engineer"`). Affects the next `fetch_jobs` call. |
| `set_work_type` | Enables or disables a work arrangement filter: `remote`, `hybrid`, or `onsite`. |
| `set_location_filter` | Adds or removes a location keyword (e.g. `"New York"`, `"Remote"`). Jobs not matching any keyword are filtered out. |

### Application Workflow

| Tool | Description |
|---|---|
| `apply_next_job` | Picks the next `new` job from the queue, marks it as `processing`, and opens it in the browser. |
| `skip_current_job` | Marks the currently processing job as `skipped`. |
| `capture_and_complete_application` | Call after `browser_confirm_submit`. Captures filled form fields, logs the application to `jobs_applied.json`, and removes the job from the queue. |

### Browser Automation

| Tool | Description |
|---|---|
| `browser_open` | Opens a URL in the persistent Chrome window and returns a snapshot of the page. |
| `browser_snapshot` | Re-captures the current page state — text content and all interactive elements with their CSS selectors. |
| `browser_navigate` | Navigates the open browser to a new URL. |
| `browser_fill` | Fills a text input or textarea. Use the selector from `browser_snapshot`. |
| `browser_select` | Selects a `<select>` dropdown option by value. |
| `browser_click` | Clicks any element (button, link, checkbox, radio). Use `labelText` for Yes/No radio groups instead of fragile selectors. Use `force: true` to bypass overlay issues. |
| `browser_press_key` | Presses a keyboard key (`ArrowDown`, `Enter`, `Escape`, `Tab`, etc.). Useful for navigating autocomplete dropdowns. |
| `browser_upload_resume` | Uploads a generated resume PDF to a `<input type="file">` field. Call `generate_resume_pdf` first. |
| `indeed_update_resume` | Replaces the resume in your Indeed profile before an Easy Apply — navigates to `my.indeed.com/profile/resume`, removes the old file, uploads the new one, then returns to the job URL. |
| `browser_confirm_submit` | **Final step.** Clicks the submit button. Only call this after the human has reviewed the filled form in the browser and explicitly approved submission. |
| `browser_close` | Closes the Chrome window. |

---

## Typical Workflow

```
# 1. Configure what you're looking for
set_job_type("senior frontend engineer", enabled: true)
set_work_type("hybrid", enabled: true)
set_location_filter("New York", enabled: true)

# 2. Fill the queue
fetch_jobs(board: "indeed", maxJobs: 20)

# 3. Review the queue
get_job_queue()

# 4. Start applying
apply_next_job()
browser_snapshot()

# 5. Generate a tailored resume
read_resume()
read_extra_context()
generate_resume_pdf(role: "Senior Frontend Engineer Acme", content: "...")

# 6. Fill the form
browser_fill(selector: "input[name='name']", value: "Johnny Carmona")
browser_upload_resume(selector: "#resume-upload", role: "Senior Frontend Engineer Acme")
browser_click(selector: "...", labelText: "Yes")   # radio/checkbox answers

# 7. Human reviews the form in the browser, then approves:
browser_confirm_submit(selector: "button[type='submit']")

# 8. Log the application
capture_and_complete_application()

# 9. Move to the next job
apply_next_job()
```

---

## Data Files

| File | Committed | Description |
|---|---|---|
| `data/resume.md` | No | Master resume (Markdown) |
| `data/extra_context.json` | No | Engineering stories for open-ended questions |
| `data/job_criteria.json` | No | Search configuration |
| `data/job_queue.json` | No | Live job queue |
| `data/jobs_applied.json` | No | Application log |
| `data/resumes/` | No | Generated resume PDFs |
| `data/cover_letters/` | No | Generated cover letter PDFs |
| `data/browser-profile/` | No | Persistent Chrome profile (cookies, logins) |

---

## Development

```bash
yarn build          # compile TypeScript → build/
yarn watch          # watch mode
```

After any code change, rebuild and restart the MCP server in your AI client before testing.
