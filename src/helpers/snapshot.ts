import type { Page } from "playwright";

export async function buildSnapshot(p: Page): Promise<string> {
    const title = await p.title();
    const url = p.url();

    const bodyText: string = await p.evaluate(() => {
        const body = document.body;
        return body ? (body.innerText ?? "").slice(0, 3000) : "";
    });

    const elements: string[] = await p.evaluate(() => {
        const results: string[] = [];

        // Helper to find associated label text
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

        // Build a stable selector for an element
        function selectorFor(el: Element): string {
            const name = el.getAttribute("name");
            if (name) {
                const tag = el.tagName.toLowerCase();
                return `${tag}[name="${name}"]`;
            }
            const id = el.getAttribute("id");
            if (id) return `#${id}`;
            const ariaLabel = el.getAttribute("aria-label");
            if (ariaLabel) {
                const tag = el.tagName.toLowerCase();
                return `${tag}[aria-label="${ariaLabel}"]`;
            }
            // fallback: tag with index among siblings
            const tag = el.tagName.toLowerCase();
            const parent = el.parentElement;
            if (parent) {
                const siblings = Array.from(parent.querySelectorAll(tag));
                const idx = siblings.indexOf(el as HTMLElement);
                if (idx >= 0) return `${tag}:nth-of-type(${idx + 1})`;
            }
            return tag;
        }

        // Inputs and textareas
        const inputs = document.querySelectorAll("input, textarea");
        inputs.forEach((el) => {
            const input = el as HTMLInputElement | HTMLTextAreaElement;
            const type = input.getAttribute("type") ?? (input.tagName === "TEXTAREA" ? "textarea" : "text");
            if (["hidden", "submit", "reset", "image"].includes(type)) return;
            const label = labelFor(el);
            const name = input.getAttribute("name") ?? "";
            const placeholder = input.getAttribute("placeholder") ?? "";
            const selector = selectorFor(el);
            let desc = `[input:${type}]`;
            if (label) desc += `  label="${label}"`;
            if (name) desc += `  name="${name}"`;
            if (placeholder && placeholder !== label) desc += `  placeholder="${placeholder}"`;
            desc += `  → selector: ${selector}`;
            results.push(desc);
        });

        // Selects
        const selects = document.querySelectorAll("select");
        selects.forEach((el) => {
            const select = el as HTMLSelectElement;
            const label = labelFor(el);
            const name = select.getAttribute("name") ?? "";
            const selector = selectorFor(el);
            const options = Array.from(select.options).map((o) => o.value || o.text).slice(0, 10);
            let desc = `[select]`;
            if (label) desc += `  label="${label}"`;
            if (name) desc += `  name="${name}"`;
            desc += `  options: [${options.map((o) => `"${o}"`).join(", ")}]`;
            desc += `  → selector: ${selector}`;
            results.push(desc);
        });

        // Buttons and submit inputs
        const buttons = document.querySelectorAll("button, input[type='submit'], input[type='button']");
        buttons.forEach((el) => {
            const text =
                (el as HTMLElement).innerText?.trim() ||
                el.getAttribute("value") ||
                el.getAttribute("aria-label") ||
                "";
            const selector = selectorFor(el);
            results.push(`[button]  text="${text}"  → selector: ${selector}`);
        });

        return results;
    });

    const lines = [
        `Page: ${title} | ${url}`,
        "",
        "--- Page Text (first 3000 chars) ---",
        bodyText.trim(),
        "",
        "--- Interactive Elements ---",
        ...elements,
    ];

    return lines.join("\n");
}
