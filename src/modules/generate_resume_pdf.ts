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
        description: `Generates a tailored resume PDF named 'Johnny Carmona {role} Resume.pdf' saved in data/resumes/.

IMPORTANT: Do NOT include contact info (name, email, phone, LinkedIn) in the content — it is auto-injected from resume.md.

The content must be valid Markdown following the exact structure of resume.md. Use resume.md as your template:

STRUCTURE (sections in this order):
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

TAILORING RULES:
- ## Objective: rewrite to target this specific role and company
- ## Professional Summary: emphasize most relevant background
- ## Technical Skills: reorder so most relevant skills appear first; only include skills from resume.md
- ## Professional Experience: rewrite bullets to be professional and impactful for this role. Do NOT fabricate. Keep ALL jobs.
- ## Education and ## Immigration Status: copy verbatim from resume.md

Call read_resume first before crafting content.`,
        inputSchema: z.object({
            role: z.string().describe("The job position/title extracted from the job description (e.g. 'Senior Software Engineer')"),
            content: z.string().describe("Full tailored resume body in Markdown, following resume.md structure. Do NOT include contact info — auto-injected."),
        }),
    },
    async ({ role, content }) => {
        try {
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);

            // Always read contact info from resume.md
            const resumeMd = await fs.readFile(path.join(__dirname, "../../data/resume.md"), "utf-8").catch(() => "");
            const extractField = (label: string) =>
                resumeMd.match(new RegExp(`${label}[:\\s]+(.+)`, "i"))?.[1]?.trim() ?? "";
            const candidateName = (resumeMd.match(/^#\s+(.+)/m)?.[1] ?? "Johnny Carmona").trim();
            const email = extractField("email");
            const phone = extractField("phone");
            const linkedin = extractField("linkedin");

            const resumesDir = path.join(__dirname, "../../data/resumes");
            await fs.mkdir(resumesDir, { recursive: true });

            const fileName = `Johnny Carmona ${role} Resume.pdf`;
            const filePath = path.join(resumesDir, fileName);

            await new Promise<void>((resolve, reject) => {
                const doc = new PDFDocument({ margin: 54, size: "LETTER" });
                const stream = createWriteStream(filePath);
                doc.pipe(stream);

                const marginLeft = doc.page.margins.left;
                const pageWidth = doc.page.width - marginLeft - doc.page.margins.right;

                // ── Contact header (always from resume.md) ───────────────────
                doc.fontSize(20).font("Helvetica-Bold").fillColor("#1a1a1a")
                    .text(candidateName, { align: "center", lineGap: 2 });
                const contactParts = [email, phone, linkedin].filter(Boolean);
                if (contactParts.length) {
                    doc.fontSize(9).font("Helvetica").fillColor("#444444")
                        .text(contactParts.join("   |   "), { align: "center", lineGap: 2 });
                }
                // Header divider
                doc.moveDown(0.5);
                const headerRuleY = doc.y;
                doc.moveTo(marginLeft, headerRuleY)
                    .lineTo(marginLeft + pageWidth, headerRuleY)
                    .strokeColor("#1a1a1a").lineWidth(1).stroke();
                doc.moveDown(0.6);
                doc.fillColor("#000000");

                // ── Markdown-aware body renderer ─────────────────────────────
                const lines = content.split("\n");
                for (let i = 0; i < lines.length; i++) {
                    const raw = lines[i] ?? "";
                    const trimmed = raw.trim();

                    if (!trimmed) {
                        doc.moveDown(0.2);
                        continue;
                    }

                    // ## Section header
                    if (/^##\s+/.test(trimmed)) {
                        const text = trimmed.replace(/^##\s+/, "").toUpperCase();
                        doc.moveDown(0.5)
                            .fontSize(9.5).font("Helvetica-Bold").fillColor("#1a1a1a")
                            .text(text, { lineGap: 2, characterSpacing: 0.8 });
                        const ruleY = doc.y + 2;
                        doc.moveTo(marginLeft, ruleY)
                            .lineTo(marginLeft + pageWidth, ruleY)
                            .strokeColor("#1a1a1a").lineWidth(0.75).stroke();
                        doc.moveDown(0.4).fontSize(10).font("Helvetica").fillColor("#000000");
                        continue;
                    }

                    // ### Job title line
                    if (/^###\s+/.test(trimmed)) {
                        const text = trimmed.replace(/^###\s+/, "");
                        doc.moveDown(0.4).fontSize(10.5).font("Helvetica-Bold")
                            .fillColor("#1a1a1a").text(text, { lineGap: 2 });
                        doc.font("Helvetica").fillColor("#000000");
                        continue;
                    }

                    // *italic line* — date range
                    if (/^\*[^*].+\*$/.test(trimmed) || /^\*\S+\*$/.test(trimmed)) {
                        const text = trimmed.replace(/^\*/, "").replace(/\*$/, "");
                        doc.fontSize(9.5).font("Helvetica-Oblique").fillColor("#555555")
                            .text(text, { lineGap: 3 });
                        doc.font("Helvetica").fillColor("#000000").moveDown(0.15);
                        continue;
                    }

                    // **Label:** value — skill category
                    if (/^\*\*[^*]+:\*\*/.test(trimmed)) {
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
                            .text(`\u25e6 ${text}`, { lineGap: 2.5, indent: 22 });
                        continue;
                    }

                    // - bullet point
                    if (/^-\s+/.test(trimmed)) {
                        const text = trimmed.replace(/^-\s+/, "");
                        doc.fontSize(10).font("Helvetica").fillColor("#000000")
                            .text(`\u2022 ${text}`, { lineGap: 3, indent: 12 });
                        continue;
                    }

                    // Regular body text (strip stray markdown)
                    const plain = trimmed.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
                    doc.fontSize(10).font("Helvetica").fillColor("#000000").text(plain, { lineGap: 3 });
                }

                doc.end();
                stream.on("finish", resolve);
                stream.on("error", reject);
            });

            return {
                content: [{ type: "text", text: `Resume PDF saved to data/resumes/${fileName}` }]
            };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Failed to generate resume PDF: ${(error as Error).message}` }]
            };
        }
    }
);
