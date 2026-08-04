// Copies static renderer assets (HTML/CSS/JS) into dist so Electron can load them.
const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "..", "src", "ui", "renderer");
const outDir = path.join(__dirname, "..", "dist", "ui", "renderer");

fs.mkdirSync(outDir, { recursive: true });

for (const file of fs.readdirSync(srcDir)) {
  if (/\.(html|css|js|png|svg|ico)$/.test(file)) {
    fs.copyFileSync(path.join(srcDir, file), path.join(outDir, file));
  }
}

console.log("[copy-assets] renderer assets copied to dist/ui/renderer");
