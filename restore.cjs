const fs = require('fs');

const file18 = fs.readFileSync('extracted_chat_18.txt', 'utf8');
const file19 = fs.readFileSync('extracted_chat_19.txt', 'utf8');

const lines18 = file18.split('\n').filter(l => /^\d+: /.test(l)).map(l => l.replace(/^\d+: /, ''));
const lines19 = file19.split('\n').filter(l => /^\d+: /.test(l)).map(l => l.replace(/^\d+: /, ''));

// lines18 has lines 1-150. lines19 has lines 145-155.
// So we just take lines18 (which is 150 lines), and lines 151-155 from lines19.

const fullLines = lines18.concat(lines19.slice(6)); // 151-155

fs.writeFileSync('supabase/functions/chat-turn/index.ts', fullLines.join('\n'));
console.log('Restored chat-turn/index.ts. Total lines:', fullLines.length);
