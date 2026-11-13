const fs = require('fs');
const buf = fs.readFileSync('../RKStorage_check.db');
const str = buf.toString('binary');
console.log('File size:', buf.length);

// Extract strings from sqlite file
const matches = str.match(/eyJ[a-zA-Z0-9_\-\.]+/g) || [];
console.log('Found JWT tokens:', matches.length);
if (matches.length > 0) {
  fs.writeFileSync('temp_token.txt', matches[0]);
  console.log('Saved token preview:', matches[0].slice(0, 40));
}
