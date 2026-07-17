const fs = require('fs');
const path = require('path');

const patchFiles = [
  'node_modules/recharts/es6/component/Tooltip.js',
  'node_modules/recharts/es6/zIndex/ZIndexLayer.js',
  'node_modules/recharts/es6/component/Legend.js',
  'node_modules/react-leaflet/lib/Pane.js',
  'node_modules/react-leaflet/lib/SVGOverlay.js',
  'node_modules/@react-leaflet/core/lib/component.js',
  
  // also check local apps just in case
  'apps/admin-portal/node_modules/react-leaflet/lib/Pane.js',
  'apps/admin-portal/node_modules/react-leaflet/lib/SVGOverlay.js',
  'apps/admin-portal/node_modules/@react-leaflet/core/lib/component.js',
];

patchFiles.forEach((file) => {
  const fullPath = path.resolve(__dirname, '..', file);
  if (fs.existsSync(fullPath)) {
    let code = fs.readFileSync(fullPath, 'utf8');
    if (code.includes('import { createPortal } from "react-dom";') || code.includes("import { createPortal } from 'react-dom';")) {
      code = code.replace(
        /import\s*\{\s*createPortal\s*\}\s*from\s*['"]react-dom['"];?/g,
        "import __reactDom from 'react-dom';\nconst { createPortal } = __reactDom;"
      );
      fs.writeFileSync(fullPath, code);
      console.log('Patched', file);
    } else {
      console.log('Already patched or not found:', file);
    }
  } else {
    console.log('File not found:', file);
  }
});
