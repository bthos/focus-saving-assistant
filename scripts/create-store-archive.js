/**
 * Pack dist/ into <package name>-<manifest version>.zip for upload to the Chrome Web Store / Edge Add-ons.
 * manifest.json sits at the archive root, as the stores require.
 * Zero dependencies: writes the ZIP format directly with node:zlib.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const manifestPath = path.join(distDir, 'manifest.json');

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function listFiles(dir, base = '') {
  const result = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (fs.statSync(full).isDirectory()) {
      result.push(...listFiles(full, rel));
    } else if (!name.endsWith('.map')) {
      result.push({ full, rel });
    }
  }
  return result;
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { full, rel } of files) {
    const data = fs.readFileSync(full);
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = compressed.length < data.length;
    const body = useDeflate ? compressed : data;
    const name = Buffer.from(rel, 'utf8');
    const { time, day } = dosDateTime(fs.statSync(full).mtime);
    const crc = crc32(data);
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const centralSize = centralParts.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

if (!fs.existsSync(manifestPath)) {
  console.error('dist/manifest.json not found: run the build before creating the store archive');
  process.exit(1);
}

const pkgName = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).name;
const version = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version;
const outFile = path.join(rootDir, `${pkgName}-${version}.zip`);
const files = listFiles(distDir);
fs.rmSync(outFile, { force: true });
fs.writeFileSync(outFile, createZip(files));
console.log(`✓ Store archive created: ${path.relative(process.cwd(), outFile)} (${files.length} files, ${(fs.statSync(outFile).size / 1024).toFixed(1)} KB)`);
