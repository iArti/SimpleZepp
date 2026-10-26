// Checks that every name imported from a local module is exported there.
// Rollup in zeus doesn't fail on this, and the watch then shows an empty screen.
// Run from zepp/: node tools/check_imports.js
const fs = require("fs");
const path = require("path");

const files = [
  "app.js",
  "app-side/index.js",
  "app-widget/index.js",
  ...fs.readdirSync("page").map((d) => `page/${d}/index.js`),
];

let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*"(\.[^"]+)"/g)) {
    const target = path.join(path.dirname(f), m[2] + ".js");
    const exported = fs.readFileSync(target, "utf8");
    for (const name of m[1].split(",").map((x) => x.trim()).filter(Boolean)) {
      const re = new RegExp(`export\\s+(const|function|let)\\s+${name}\\b`);
      if (!re.test(exported)) {
        console.log(`${f} -> ${m[2]}: missing ${name}`);
        bad++;
      }
    }
  }
}
console.log(bad ? `${bad} unresolved imports` : "all local imports resolve");
process.exit(bad ? 1 : 0);
