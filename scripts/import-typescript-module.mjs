import path from "node:path";
import { build } from "vite";

export async function importTypeScriptModule(relativePath) {
    const result = await build({
        configFile: false,
        logLevel: "silent",
        build: {
            write: false,
            lib: {
                entry: path.join(process.cwd(), relativePath),
                formats: ["es"],
            },
        },
    });
    const output = Array.isArray(result) ? result.flatMap((item) => item.output) : result.output;
    const code = output.find((item) => item.type === "chunk")?.code;
    if (!code) throw new Error(`TypeScript bundle was not generated for ${relativePath}.`);
    return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}
