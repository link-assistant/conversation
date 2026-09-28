import { decode, encode } from 'lino-objects-codec';

const graph = {
  schema: 'link-assistant-conversation/v1',
  nodes: [{ id: 'root', type: 'conversation' }],
  links: [],
};
const notation = encode({ obj: graph });
const roundTrip = decode({ notation });
if (JSON.stringify(roundTrip) !== JSON.stringify(graph)) {
  throw new Error('Links Notation codec did not round trip the graph');
}
console.log(notation);
