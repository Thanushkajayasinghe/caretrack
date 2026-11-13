const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) results = results.concat(walk(p));
    else if (f.endsWith('.js')) results.push(p);
  }
  return results;
}

const files = walk('parent-app/src').concat(['parent-app/App.js']);
files.forEach(f => {
  const code = fs.readFileSync(f, 'utf8');
  if (code.includes('reanimated') || code.includes('withSpring') || code.includes('useSharedValue')) {
    console.log('REANIMATED IN:', f);
  }
});
