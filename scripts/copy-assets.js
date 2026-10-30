/**
 * Script for copying static files to dist
 */

const fs = require('fs');
const path = require('path');

const assetsToCopy = [
  { from: 'src/pages', to: 'dist/pages', processHtml: true },
  { from: 'src/styles', to: 'dist/styles' },
  { from: 'src/icons', to: 'dist/icons' },
  { from: 'src/assets', to: 'dist/assets' },
  { from: 'src/manifest.json', to: 'dist/manifest.json' }
];

function processHtmlFile(filePath, content) {
  // Replace .ts file references with .js
  let processed = content.replace(/\.ts(['"])/g, '.js$1');
  // Remove type="module" from script tags only for popup.html (Chrome Extensions support ES modules in options pages)
  // Keep type="module" for options.html and other pages that need ES modules
  if (filePath.includes('popup.html')) {
    processed = processed.replace(/<script([^>]*)\s+type=["']module["']([^>]*)>/gi, '<script$1$2>');
  }
  return processed;
}

function copyRecursive(src, dest, processHtml = false) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach(childItemName => {
      // Skip TypeScript files and source maps (they are already compiled)
      if (childItemName.endsWith('.ts') || childItemName.endsWith('.ts.map')) {
        return;
      }
      copyRecursive(
        path.join(src, childItemName),
        path.join(dest, childItemName),
        processHtml
      );
    });
  } else {
    // Skip TypeScript files
    if (src.endsWith('.ts') || src.endsWith('.ts.map')) {
      return;
    }
    
    if (!fs.existsSync(path.dirname(dest))) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
    }
    
    // Process HTML files
    if (processHtml && src.endsWith('.html')) {
      const content = fs.readFileSync(src, 'utf8');
      const processed = processHtmlFile(src, content);
      fs.writeFileSync(dest, processed, 'utf8');
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

// Copy all assets
assetsToCopy.forEach(({ from, to, processHtml }) => {
  const srcPath = path.join(__dirname, '..', from);
  const destPath = path.join(__dirname, '..', to);
  
  if (fs.existsSync(srcPath)) {
    copyRecursive(srcPath, destPath, processHtml);
    console.log(`✓ Copied ${from} -> ${to}`);
  }
});

console.log('✓ Assets copied successfully');
