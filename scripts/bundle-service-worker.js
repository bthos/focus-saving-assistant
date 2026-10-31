/**
 * Bundle service worker using esbuild
 * Service Workers don't support ES modules, so we need to bundle everything into a single file
 */

const esbuild = require('esbuild');
const path = require('path');

async function bundleServiceWorker() {
  try {
    const result = await esbuild.build({
      entryPoints: [path.join(__dirname, '../src/background/service-worker.ts')],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      target: 'es2020',
      minify: false,
      sourcemap: true,
      external: ['chrome'],
      banner: {
        js: '// Service Worker - bundled with esbuild'
      }
    });
    
    // Write the bundled code directly (IIFE will execute immediately)
    const fs = require('fs');
    const outputPath = path.join(__dirname, '../dist/background/service-worker.js');
    const outputDir = path.dirname(outputPath);
    
    // Ensure directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Write the bundled code
    let bundledCode = result.outputFiles[0].text;
    
    // Remove sourceMappingURL comment to prevent Chrome from trying to load source files
    // that don't exist in the dist folder
    bundledCode = bundledCode.replace(/\/\/# sourceMappingURL=.*$/gm, '');
    
    fs.writeFileSync(outputPath, bundledCode);
    
    // Write source map if available (but don't reference it in the bundle)
    if (result.outputFiles.length > 1) {
      const mapPath = outputPath + '.map';
      fs.writeFileSync(mapPath, result.outputFiles[1].text);
    }
    
    console.log('✓ Service worker bundled successfully');
  } catch (error) {
    console.error('Error bundling service worker:', error);
    process.exit(1);
  }
}

bundleServiceWorker();
