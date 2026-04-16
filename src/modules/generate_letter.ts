import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";
import { createWriteStream } from "fs";
import { z } from "zod";
import { server } from "../server.js";

server.registerTool(
    "generate_letter",
    {
        description: "Generates a cover letter PDF from the provided content and saves it to data/cover_letters/",
        inputSchema: z.object({
            role: z.string().describe("The job role/title being applied for"),
            company: z.string().describe("The name of the company"),
            content: z.string().describe("The full text of the cover letter")
        }),
    },
    async ({ role, company, content }) => {
        try {
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);
            const coverLettersDir = path.join(__dirname, "../../data/cover_letters");

            await fs.mkdir(coverLettersDir, { recursive: true });

            const slug = `${role}-${company}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            const fileName = `${slug}-johnny-carmona.pdf`;
            const filePath = path.join(coverLettersDir, fileName);

            await new Promise<void>((resolve, reject) => {
                const doc = new PDFDocument({ margin: 72 });
                const stream = createWriteStream(filePath);
                doc.pipe(stream);

                doc.fontSize(11).font("Helvetica").text(content, { lineGap: 4 });

                doc.end();
                stream.on("finish", resolve);
                stream.on("error", reject);
            });

            return {
                content: [{ type: "text", text: `Cover letter saved to data/cover_letters/${fileName}` }]
            };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Failed to generate cover letter: ${(error as Error).message}` }]
            };
        }
    }
);