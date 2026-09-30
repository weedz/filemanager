import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  build: {
    lib: {
      formats: ["es"],
      // Could also be a dictionary or array of multiple entry points
      // entry: resolve(__dirname, 'src/main.tsx'),
      entry: "./src/main.tsx",
      name: "filemanager",
      // the proper extensions will be added
      fileName: "filemanager",
    },
  },
});
