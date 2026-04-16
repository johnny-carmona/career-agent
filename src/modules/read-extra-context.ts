import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { server } from "../server.js";

server.registerTool(
    "read_extra_context",
    {
        description: "Reads data/extra_context.json which contains real stories, architectural challenges, and technical experiences to draw from when answering open-ended application questions. Always call this alongside read_resume before crafting answers.",
        inputSchema: z.object({}),
    },
    async () => {
        try {
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);
            const filePath = path.join(__dirname, "../../data", "extra_context.json");
            const raw = await fs.readFile(filePath, "utf-8");
            const parsed = JSON.parse(raw) as unknown;
            return {
                content: [{ type: "text", text: JSON.stringify(parsed, null, 2) }]
            };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text", text: `Could not read extra_context.json: ${(error as Error).message}` }]
            };
        }
    }
);
