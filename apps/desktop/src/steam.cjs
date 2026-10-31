// Lists installed Steam games and their executables, so automation rules can be created in one click.
// Reads only local Steam files: the registry SteamPath, libraryfolders.vdf and appmanifest_*.acf.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SKIP_EXE = /crash|unins|redist|setup|vc_?redist|dxsetup|prereq|easyanticheat|beservice|battleye|dotnet|helper|report|launcher_?helper|cefsharp|ue4prereq|uploader|benchmark/i;

function steamRoot() {
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', windowsHide: true });
    const m = /SteamPath\s+REG_SZ\s+(.+)/.exec(out);
    if (m) return path.normalize(m[1].trim());
  } catch { /* not installed */ }
  const fallback = 'C:\\Program Files (x86)\\Steam';
  return fs.existsSync(fallback) ? fallback : null;
}

function libraries(root) {
  const libs = new Set([root]);
  try {
    const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(path.normalize(m[1].replace(/\\\\/g, '\\')));
  } catch { /* single library */ }
  // The registry and the vdf spell the same folder with different casing.
  const seen = new Map();
  for (const l of libs) if (!seen.has(l.toLowerCase())) seen.set(l.toLowerCase(), l);
  return [...seen.values()];
}

function findExes(dir, depth = 0, out = []) {
  if (depth > 4 || out.length > 30) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!/^(_commonredist|redist|directx|vcredist|engine\\binaries\\thirdparty)$/i.test(e.name)) findExes(p, depth + 1, out);
    } else if (/\.exe$/i.test(e.name) && !SKIP_EXE.test(e.name)) out.push(e.name);
  }
  return out;
}

/** @returns {{ appid: string, name: string, exes: string[] }[]} */
function scanSteamGames() {
  const root = steamRoot();
  if (!root) return [];
  const games = [];
  for (const lib of libraries(root)) {
    const apps = path.join(lib, 'steamapps');
    let files = [];
    try { files = fs.readdirSync(apps).filter((f) => /^appmanifest_\d+\.acf$/.test(f)); } catch { continue; }
    for (const f of files) {
      try {
        const acf = fs.readFileSync(path.join(apps, f), 'utf8');
        const name = /"name"\s+"([^"]+)"/.exec(acf)?.[1];
        const dir = /"installdir"\s+"([^"]+)"/.exec(acf)?.[1];
        const appid = /"appid"\s+"(\d+)"/.exec(acf)?.[1] ?? f.replace(/\D/g, '');
        if (!name || !dir || /redistributable|proton|steamworks|soundtrack/i.test(name)) continue;
        const exes = [...new Set(findExes(path.join(apps, 'common', dir)))];
        if (exes.length && !games.some((g) => g.appid === appid)) games.push({ appid, name, exes });
      } catch { /* unreadable manifest */ }
    }
  }
  return games.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { scanSteamGames };
