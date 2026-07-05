import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8")) as {
  version: string;
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/stageverify/",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
