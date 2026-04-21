import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { server } from "../server.js";

server.registerTool(
    "read_resume",
    {
        description: "Reads the candidate's resume from data/resume.md and returns its full text. Call this before generating a resume PDF, cover letter, or filling in application questions.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            // Pointing specifically to your .txt file
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);
            const resumePath = path.join(__dirname, "../../data", "resume.md");
            const content = await fs.readFile(resumePath, "utf-8");

            return {
                content: [{ type: "text", text: content }]
            };
        } catch (error) {
            return {
                isError: true,
                content: [{
                    type: "text",
                    text: "resume.md not found. Please ensure it's in the data folder at the project root."
                }]
            };
        }
    }
);