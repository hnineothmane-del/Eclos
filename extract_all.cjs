const fs = require('fs');
const lines = fs.readFileSync('C:/Users/a/.gemini/antigravity/brain/20b86108-221d-46d8-a6f4-d9bbd4281c48/.system_generated/logs/transcript_full.jsonl', 'utf-8').split('\n');
let i = 0;
for (let l of lines) {
  if (l.includes('chat-turn/index.ts') && l.includes('"type":"GENERIC"')) {
    try {
      const data = JSON.parse(l);
      fs.writeFileSync(`extracted_chat_${i}.txt`, data.content);
      i++;
    } catch(e) {}
  }
}
