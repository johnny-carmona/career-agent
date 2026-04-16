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
        description: "Generates a tailored resume PDF named 'Johnny Carmona {role} Resume.pdf' saved in data/resumes/. The content should be a rewritten/reordered version of the candidate's resume emphasising experience relevant to the job description. Call read_resume and browser_open first to have both the resume and job description available, then craft the tailored content before calling this tool. Call this before browser_upload_resume.",
        inputSchema: z.object({
            role: z.string().describe("The job position/title extracted from the job description (e.g. 'Senior Software Engineer')"),
            content: z.string().describe("The full tailored resume text, rewritten to emphasise skills and experience most relevant to the job description"),
        }),
    },
    async ({ role, content }) => {
        try {
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);
            const resumesDir = path.join(__dirname, "../../data/resumes");
            await fs.mkdir(resumesDir, { recursive: true });

            const fileName = `Johnny Carmona ${role} Resume.pdf`;
            const filePath = path.join(resumesDir, fileName);

            await new Promise<void>((resolve, reject) => {
                const doc = new PDFDocument({ margin: 72 });
                const stream = createWriteStream(filePath);
                doc.pipe(stream);

                const lines = content.split("\n");
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) {
                        // blank line → small vertical gap
                        doc.moveDown(0.3);
                    } else if (trimmed === trimmed.toUpperCase() && trimmed.length > 2 && /^[A-Z]/.test(trimmed)) {
                        // ALL-CAPS line → section header
                        doc.moveDown(0.4)
                            .fontSize(12).font("Helvetica-Bold").text(trimmed, { lineGap: 2 })
                            .moveTo(doc.page.margins.left, doc.y)
                            .lineTo(doc.page.width - doc.page.margins.right, doc.y)
                            .strokeColor("#aaaaaa").lineWidth(0.5).stroke()
                            .moveDown(0.2);
                        doc.fontSize(11).font("Helvetica");
                    } else if (trimmed.startsWith("- ")) {
                        // bullet point
                        doc.fontSize(11).font("Helvetica").text(line, { lineGap: 3, indent: 12 });
                    } else if (/^[A-Z]/.test(trimmed) && trimmed.endsWith("|") === false && lines[lines.indexOf(line) + 1]?.trim().startsWith("-")) {
                        // job title / company line (line followed by bullets)
                        doc.fontSize(11).font("Helvetica-Bold").text(trimmed, { lineGap: 2 });
                        doc.font("Helvetica");
                    } else {
                        doc.fontSize(11).font("Helvetica").text(line, { lineGap: 3 });
                    }
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
