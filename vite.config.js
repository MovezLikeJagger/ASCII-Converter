import { defineConfig } from "vite";

const productionBase = process.env.VITE_BASE_PATH || "./";

export default defineConfig({
  base: process.env.NODE_ENV === "production" ? productionBase : "/",
});
