const fs = require('fs');
const lines = fs.readFileSync('C:/Users/a/.gemini/antigravity/brain/20b86108-221d-46d8-a6f4-d9bbd4281c48/.system_generated/logs/transcript_full.jsonl', 'utf-8').split('\n');
for (let l of lines) {
  if (l.includes('"step_index":1934,')) {
    const data = JSON.parse(l);
    if (data.content) fs.writeFileSync('extracted_1934.txt', data.content);
  }
}
