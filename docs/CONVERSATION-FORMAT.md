# Conversation archive v1

The portable object model has three top-level fields: `schema`, `nodes`, and
`links`. The schema string is `link-assistant-conversation/v1`.

The sole `conversation` node holds the archive ID and optional `sourceFormat`.
Every imported JSONL line becomes a `message` or `event` node. Each node keeps
its complete parsed `original` record and `nativeFormat`. Message nodes also
hold a normalized `role` and `content` array. Content blocks have types `text`,
`tool_call`, `tool_result`, or `native`. A `native` block retains a source block
that the current cross-format adapter cannot translate.

Links are `{ "source": "...", "type": "...", "target": "..." }`. The
relations are:

| Relation   | Meaning                                                      |
| ---------- | ------------------------------------------------------------ |
| `contains` | Conversation root contains a record                          |
| `precedes` | A record immediately precedes another record in the JSONL    |
| `reply_to` | A message is the parent of another message, preserving forks |

The order of the `nodes` array is not the conversation order; the `precedes`
chain is authoritative. Every non-root node must have one `contains` link. The
chain must cover all records exactly once. Each `reply_to` points from an
earlier message to a later one, and each child has at most one parent. Replies
may fork and can be absent when the source has no parent ID or references a
missing message.

## Text formats

`.json` is the object model serialized as JSON. `.lino` is the same model
encoded as readable Links Notation using `lino-objects-codec`. Both libraries
validate the graph when reading it.

## Binary format

`.bin` is a portable binary link archive. Multi-byte integers are unsigned
32-bit little-endian. All strings are UTF-8.

1. Eight ASCII bytes: `LACB0001`.
2. Node count (u32), then link count (u32).
3. For each node: JSON byte length (u32), then that many UTF-8 JSON bytes.
4. For each link: source node index (u32), relation code (u8), target node
   index (u32). Node indices are zero-based. Relation codes are `1` for
   `contains`, `2` for `precedes`, and `3` for `reply_to`.

Decoders reject invalid indices, unknown relation codes, truncated records,
trailing bytes, and graphs that violate the link invariants. This is a
documented portable binary encoding of links; it is not a `doublets` store
file.

## Source adapters

`codex` reads rollout JSONL records. It normalizes `response_item` messages,
function calls, and function call outputs. Consecutive normalized messages
receive `reply_to` links. Other records, including
`session_meta` and event notifications, remain as archive events.

`claude` reads Claude Code session JSONL. It normalizes user and assistant
messages, text, tool uses, and tool results. `parentUuid` becomes a `reply_to`
link when the referenced message is present. Other records remain as events.

Export to the original format retains every parsed source record. Export to a
different format creates JSONL messages from normalized content. Native blocks
that lack a target representation cause an error, so export does not silently
discard their content. Source metadata and non-message events remain in the
archive; cross-format JSONL carries only the normalized messages. The generated
files are not yet verified as resumable sessions in the vendor applications.
