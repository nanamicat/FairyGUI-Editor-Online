import { defineConfig } from "vite";

export default defineConfig({
    // UI packages and the frozen Laya/FairyGUI runtime are static inputs.
    publicDir: "assets",
    base: "./",
    build: {
        outDir: "vite-dist",
        emptyOutDir: true,
        target: "es2021",
    },
});
