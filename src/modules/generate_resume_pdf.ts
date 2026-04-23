import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";
import { createWriteStream } from "fs";
import { z } from "zod";
import { server } from "../server.js";

server.registerTool(
    "generate_resume_pdf",
    {
        description: `Generates a resume PDF named 'Johnny Carmona {role} Resume.pdf' saved in data/resumes/.

MODES:
- passthrough: true  → Renders resume.md EXACTLY as-is. The 'content' parameter is IGNORED. Use this for general-purpose resumes.
- passthrough: false (default) → Renders the 'content' you provide. Use this for tailored resumes.

IMPORTANT: Do NOT include contact info (name, email, phone, LinkedIn) in the content — it is auto-injected from resume.md.

The content must be valid Markdown following the exact structure of resume.md. Use resume.md as your template:

REQUIRED SECTIONS — ALL 6 MUST BE PRESENT (tool will reject if any are missing):
  ## Objective
  ## Professional Summary
  ## Technical Skills
  ## Professional Experience
  ## Education
  ## Immigration Status

MARKDOWN CONVENTIONS:
- ## Heading    → section header with rule
- ### Heading   → job title line (bold)
- *italic line* → date range line (italic, gray) — must be its own line
- **Label:** value → skill category (bold label, regular value)
- - bullet      → bullet point with indent
- plain text    → regular body paragraph

JOB ENTRY FORMAT:
  ### Title, Company, Location
  *Month YYYY - Month YYYY*

  - Description line
  - Another description line

SKILLS FORMAT:
  **Programming Languages:** JavaScript, TypeScript, Python
  **Frontend Frameworks:** React, Angular, Vue.js

TAILORING RULES — STRICT:
- ## Objective: rewrite to target this specific role and company
- ## Professional Summary: emphasize most relevant background (do NOT remove)
- ## Technical Skills: reorder so most relevant skills appear first; only include skills from resume.md (do NOT remove this section)
- ## Professional Experience: KEEP ALL JOBS from resume.md — NEVER omit any job entry; rewrite bullets to highlight relevant experience; do NOT fabricate skills or titles
- ## Education: copy verbatim from resume.md (do NOT remove)
- ## Immigration Status: copy verbatim from resume.md (do NOT remove)
- Omitting ANY of the 6 required sections will cause the tool to return an error and refuse to generate the PDF.

Call read_resume first before crafting content.`,
        inputSchema: z.object({
            role: z.string().describe("The job position/title extracted from the job description (e.g. 'Senior Software Engineer')"),
            content: z.string().describe("Full tailored resume body in Markdown, following resume.md structure. Do NOT include contact info — auto-injected. IGNORED when passthrough=true."),
            passthrough: z.boolean().optional().default(false).describe("When true, renders resume.md exactly as-is without any AI-provided content. Use for general-purpose resumes."),
        }),
    },
    async ({ role, content, passthrough }) => {
        try {
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);

            // Always read contact info from resume.md
            const resumeMd = await fs.readFile(path.join(__dirname, "../../data/resume.md"), "utf-8").catch(() => "");
            const candidateName = (resumeMd.match(/^#\s+(.+)/m)?.[1] ?? "Johnny Carmona").trim();

            // Grab all lines between the # name line and the first ### section header as contact lines
            const mdLines = resumeMd.split("\n");
            const nameLineIdx = mdLines.findIndex(l => /^#\s+/.test(l));
            const firstSectionIdx = mdLines.findIndex((l, i) => i > nameLineIdx && /^#{2,3}\s+/.test(l));
            // Keep raw contact lines (preserve markdown for bold rendering)
            const contactLines = mdLines
                .slice(nameLineIdx + 1, firstSectionIdx === -1 ? undefined : firstSectionIdx)
                .map(l => l.trim())
                .filter(l => l.length > 0 && l !== "---");

            // ── Section validation for tailored resumes ─────────────────
            if (!passthrough) {
                const requiredSections = [
                    "## Objective",
                    "## Professional Summary",
                    "## Technical Skills",
                    "## Professional Experience",
                    "## Education",
                    "## Immigration Status",
                ];
                const missingSections = requiredSections.filter(s => !content.includes(s));
                if (missingSections.length > 0) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: `Resume content is missing required sections: ${missingSections.join(", ")}.All 6 sections must be present.Please regenerate the content including ALL required sections.` }]
                    };
                }
            }

            const resumesDir = path.join(__dirname, "../../data/resumes");
            await fs.mkdir(resumesDir, { recursive: true });

            const fileName = `Johnny Carmona ${role} Resume.pdf`;
            const filePath = path.join(resumesDir, fileName);

            await new Promise<void>((resolve, reject) => {
                const doc = new PDFDocument({ margin: 54, size: "LETTER", autoFirstPage: true });
                const stream = createWriteStream(filePath);
                doc.pipe(stream);

                const marginLeft = doc.page.margins.left;
                const pageWidth = doc.page.width - marginLeft - doc.page.margins.right;
                const pageBottomMargin = doc.page.margins.bottom;

                const checkPageBreak = (neededHeight = 40) => {
                    const pageHeight = doc.page.height;
                    if (doc.y + neededHeight > pageHeight - pageBottomMargin) {
                        doc.addPage();
                    }
                };

                // ── Contact header (always from resume.md) ───────────────────
                doc.fontSize(20).font("Helvetica-Bold").fillColor("#1a1a1a")
                    .text(candidateName, { align: "center", lineGap: 2 });
                for (const line of contactLines) {
                    const plain = line.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
                    doc.fontSize(9).font("Helvetica").fillColor("#444444")
                        .text(plain, { align: "center", lineGap: 2 });
                }
                doc.moveDown(0.6);
                doc.fillColor("#000000");

                // ── Body renderer ─────────────────────────────────────────
                const lines = passthrough ? resumeMd.split("\n") : content.split("\n");
                // For passthrough, skip the contact header block (everything before the first ### or ## section)
                let pastContactBlock = !passthrough;
                for (let i = 0; i < lines.length; i++) {
                    const raw = lines[i] ?? "";
                    const trimmed = raw.trim();

                    // Skip contact block for passthrough — stop skipping at first section header
                    if (!pastContactBlock) {
                        if (/^#{2,3}\s+/.test(trimmed)) pastContactBlock = true;
                        else continue;
                    }

                    if (!trimmed) {
                        doc.moveDown(0.2);
                        continue;
                    }

                    // Skip horizontal rules and h1 (passthrough)
                    if (trimmed === "---" || /^#\s+/.test(trimmed)) {
                        doc.moveDown(0.3);
                        continue;
                    }

                    // resume.md uses ### for section headers and ** for job entries
                    // Handle **bold** *italic* on same line (job entry in resume.md)
                    // e.g. **Sr. Engineer | Company** *Location | Date*
                    if (passthrough && /^\*\*[^*]+\*\*\s+\*[^*]+\*\s*$/.test(trimmed)) {
                        checkPageBreak(50);
                        const boldMatch = trimmed.match(/^\*\*([^*]+)\*\*\s+\*([^*]+)\*\s*$/);
                        if (boldMatch) {
                            doc.moveDown(0.4)
                                .fontSize(10.5).font("Helvetica-Bold").fillColor("#1a1a1a")
                                .text(boldMatch[1] ?? "", { lineGap: 1 });
                            doc.fontSize(9.5).font("Helvetica-Oblique").fillColor("#555555")
                                .text(boldMatch[2] ?? "", { lineGap: 3 });
                            doc.font("Helvetica").fillColor("#000000").moveDown(0.15);
                            continue;
                        }
                    }

                    // resume.md uses * for bullets (passthrough)
                    if (passthrough && /^\*\s+/.test(trimmed) && !/^\*\*/.test(trimmed)) {
                        checkPageBreak(20);
                        const text = trimmed.replace(/^\*\s+/, "");
                        // Always render with bullet marker; bold the label if **Label:** format
                        const labelMatch = text.match(/^\*\*([^*]+):\*\*\s*(.*)/);
                        if (labelMatch) {
                            doc.fontSize(10).font("Helvetica").fillColor("#000000")
                                .text("\u2022 ", { continued: true, lineGap: 3, indent: 12 });
                            doc.font("Helvetica-Bold").fillColor("#1a1a1a")
                                .text((labelMatch[1] ?? "") + ": ", { continued: true, lineGap: 3 });
                            doc.font("Helvetica").fillColor("#000000").text(labelMatch[2] ?? "", { lineGap: 3 });
                        } else {
                            const plain = text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
                            doc.fontSize(10).font("Helvetica").fillColor("#000000")
                                .text(`\u2022 ${plain}`, { lineGap: 3, indent: 12 });
                        }
                        continue;
                    }

                    // ## Section header (tailored) or ### Section header (passthrough/resume.md)
                    if (/^##\s+/.test(trimmed) || (passthrough && /^###\s+/.test(trimmed))) {
                        checkPageBreak(50);
                        const text = trimmed.replace(/^#{2,3}\s+/, "").toUpperCase();
                        doc.moveDown(0.5)
                            .fontSize(9.5).font("Helvetica-Bold").fillColor("#1a1a1a")
                            .text(text, { lineGap: 2, characterSpacing: 0.8 });
                        doc.moveDown(0.4).fontSize(10).font("Helvetica").fillColor("#000000");
                        continue;
                    }

                    // ### Job title line (tailored mode only — passthrough uses ### for sections above)
                    if (!passthrough && /^###\s+/.test(trimmed)) {
                        checkPageBreak(50);
                        const text = trimmed.replace(/^###\s+/, "");
                        doc.moveDown(0.4).fontSize(10.5).font("Helvetica-Bold")
                            .fillColor("#1a1a1a").text(text, { lineGap: 2 });
                        doc.font("Helvetica").fillColor("#000000");
                        continue;
                    }

                    // *italic line* — date range
                    if (/^\*[^*].+\*$/.test(trimmed) || /^\*\S+\*$/.test(trimmed)) {
                        checkPageBreak(30);
                        const text = trimmed.replace(/^\*/, "").replace(/\*$/, "");
                        doc.fontSize(9.5).font("Helvetica-Oblique").fillColor("#555555")
                            .text(text, { lineGap: 3 });
                        doc.font("Helvetica").fillColor("#000000").moveDown(0.15);
                        continue;
                    }

                    // **Label:** value — skill category
                    if (/^\*\*[^*]+:\*\*/.test(trimmed)) {
                        checkPageBreak(20);
                        const match = trimmed.match(/^\*\*([^*]+):\*\*\s*(.*)/);
                        if (match) {
                            const label = (match[1] ?? "") + ":";
                            const value = match[2] ?? "";
                            doc.fontSize(10).font("Helvetica-Bold").fillColor("#1a1a1a")
                                .text(label + " ", { continued: true, lineGap: 3 });
                            doc.font("Helvetica").fillColor("#000000").text(value, { lineGap: 3 });
                            continue;
                        }
                    }

                    // Sub-bullet: lines starting with "  - " (two spaces)
                    if (/^\s{2,}-\s+/.test(raw)) {
                        const text = raw.replace(/^\s+-\s+/, "");
                        doc.fontSize(9.5).font("Helvetica").fillColor("#000000")
                            .text(`- ${text}`, { lineGap: 2.5, indent: 22 });
                        continue;
                    }

                    // - bullet point
                    if (/^-\s+/.test(trimmed)) {
                        checkPageBreak(20);
                        const text = trimmed.replace(/^-\s+/, "");
                        doc.fontSize(10).font("Helvetica").fillColor("#000000")
                            .text(`\u2022 ${text}`, { lineGap: 3, indent: 12 });
                        continue;
                    }

                    // Regular body text (strip stray markdown)
                    checkPageBreak(20);
                    const plain = trimmed.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
                    doc.fontSize(10).font("Helvetica").fillColor("#000000").text(plain, { lineGap: 3 });
                }

                doc.end();
                stream.on("finish", resolve);
                stream.on("error", reject);
            });

            return {
                content: [{ type: "text", text: `Resume PDF saved to data / resumes / ${fileName}` }]
            };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Failed to generate resume PDF: ${(error as Error).message}` }]
            };
        }
    }
);
