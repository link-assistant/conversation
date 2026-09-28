import { performance } from 'node:perf_hooks';

import { importJsonl } from '../src/conversation.js';

for (const count of [100, 200, 400]) {
  const lines = [
    JSON.stringify({ type: 'session_meta', payload: { id: 'benchmark' } }),
    ...Array.from({ length: count }, (_, index) =>
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: index % 2 ? 'assistant' : 'user',
          content: [{ type: 'input_text', text: `Message ${index}` }],
        },
      })
    ),
  ];
  const start = performance.now();
  importJsonl(`${lines.join('\n')}\n`, 'codex');
  console.log(
    `${count} messages: ${(performance.now() - start).toFixed(1)} ms`
  );
}
