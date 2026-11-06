// Same effect as the real postbuild: the published artifact must not contain sourcemaps.
const fs = require("node:fs");
const path = require("node:path");

function removeMaps(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) n += removeMaps(p);
    else if (e.name.endsWith(".map")) { fs.rmSync(p); n += 1; }
  }
  return n;
}

if (require.main === module) console.log(`postbuild: removed ${removeMaps(path.join(process.cwd(), "build", "static"))} .map file(s)`);
module.exports = { removeMaps };
