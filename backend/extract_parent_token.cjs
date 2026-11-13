const { execSync } = require('child_process');
const fs = require('fs');

const buf = execSync('adb -s 1d8a5b05 exec-out "run-as com.caretrack.parent cat databases/RKStorage"');
fs.writeFileSync('parent_rk.db', buf);
const str = buf.toString('binary');
console.log('Size:', buf.length);

const matches = str.match(/eyJ[a-zA-Z0-9_\-\.]+/g) || [];
console.log('Found JWTs:', matches.length);
if (matches.length > 0) {
  for (const m of matches) {
    try {
      const parts = m.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        console.log('Payload:', payload);
        if (payload.exp > Date.now() / 1000) {
          console.log('VALID NON-EXPIRED TOKEN FOUND!');
          fs.writeFileSync('valid_token.txt', m);
        } else {
          console.log('Token expired at', new Date(payload.exp * 1000));
        }
      }
    } catch (e) {}
  }
}

// Also check refresh token
const hexMatches = str.match(/[a-f0-9]{64,128}/g) || [];
console.log('Hex strings found:', hexMatches.length);
if (hexMatches.length > 0) {
  console.log('Hex candidates:', hexMatches.slice(0, 5));
}
