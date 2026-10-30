/**
 * Remove sourceMappingURL comments from all JavaScript files in dist/
 * and delete all .map files to prevent Chrome DevTools from trying to load source files
 */

const fs = require('fs');
const path = require('path');

function removeSourceMaps(dir) {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      // Recursively process subdirectories
      removeSourceMaps(filePath);
    } else if (file.endsWith('.js')) {
      // Read the file
      let content = fs.readFileSync(filePath, 'utf8');
      
      // Remove sourceMappingURL comments (both single-line and multi-line)
      const originalContent = content;
      content = content.replace(/\/\/# sourceMappingURL=.*$/gm, '');
      content = content.replace(/\/\*# sourceMappingURL=.*?\*\//gs, '');
      
      // Only write if content changed
      if (content !== originalContent) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`✓ Removed source map reference from ${path.relative(process.cwd(), filePath)}`);
      }
    } else if (file.endsWith('.map')) {
      // Delete source map files
      fs.unlinkSync(filePath);
      console.log(`✓ Deleted source map file ${path.relative(process.cwd(), filePath)}`);
    }
  }
}

const distDir = path.join(__dirname, '../dist');

if (!fs.existsSync(distDir)) {
  console.log('dist/ directory does not exist, skipping source map removal');
  process.exit(0);
}

console.log('Removing source map references from dist/ files...');
removeSourceMaps(distDir);
console.log('✓ Source map references removed');
