const express = require('express');
const router = express.Router();
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.post('/', async (req, res) => {
  const emails = req.body.emails;

  if (!emails || !Array.isArray(emails)) {
    return res.status(400).json({ error: 'Invalid email data' });
  }

  const emailList = emails.map((e, i) =>
    `Email ${i + 1}:\nFrom: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}`
  ).join('\n\n');

  const prompt = `
You are an AI inbox assistant. Analyze the following emails and suggest the best action for each:
- "Reply" if it needs a response
- "Archive" if it’s informational only
- "Ignore" if it looks like spam or noise

Respond in JSON like:
[
  { "action": "Reply", "reason": "Looks important", "index": 1 },
  ...
]

${emailList}
`;

  try {
    const chatResponse = await openai.chat.completions.create({
      model: "gpt-4-1106-preview",
      messages: [
        { role: "system", content: "You are an email productivity assistant." },
        { role: "user", content: prompt },
      ],
    });

    let raw = chatResponse.choices[0].message.content;

// Clean up response (remove markdown or wrapping)
const jsonStart = raw.indexOf('[');
const jsonEnd = raw.lastIndexOf(']') + 1;
const sliced = raw.slice(jsonStart, jsonEnd);

let parsed;
try {
  parsed = JSON.parse(sliced);
} catch (err) {
  console.error('Failed to parse OpenAI response:', raw);
  return res.status(500).json({ error: 'OpenAI returned invalid JSON' });
}

res.json({ suggestions: parsed });

  } catch (err) {
    console.error('OpenAI error:', err);
    res.status(500).json({ error: 'Failed to analyze emails' });
  }
});

module.exports = router;
