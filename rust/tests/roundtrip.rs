use link_assistant_conversation::{
    Link, decode_binary, decode_lino, encode_binary, encode_lino, export_jsonl, import_jsonl,
};

const CLAUDE: &str = concat!(
    "{\"type\":\"user\",\"uuid\":\"u1\",\"parentUuid\":null,\"sessionId\":\"s1\",\"message\":{\"role\":\"user\",\"content\":\"Hello\"}}\n",
    "{\"type\":\"assistant\",\"uuid\":\"a1\",\"parentUuid\":\"u1\",\"sessionId\":\"s1\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"id\":\"call1\",\"name\":\"shell\",\"input\":{\"command\":\"pwd\"}}]}}\n",
);

const CODEX: &str = concat!(
    "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s1\"}}\n",
    "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"Hello\"}]}}\n",
    "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"Hi\"}]}}\n",
);

#[test]
fn preserves_claude_records_and_parent_links() {
    let graph = import_jsonl(CLAUDE, "claude").unwrap();
    assert_eq!(graph.nodes.len(), 3);
    assert!(graph.links.iter().any(|link| link.kind == "reply_to"));
    assert_eq!(export_jsonl(&graph, "claude").unwrap(), CLAUDE);
}

#[test]
fn portable_codecs_round_trip() {
    let graph = import_jsonl(CLAUDE, "claude").unwrap();
    assert_eq!(decode_lino(&encode_lino(&graph).unwrap()).unwrap(), graph);
    assert_eq!(
        decode_binary(&encode_binary(&graph).unwrap()).unwrap(),
        graph
    );
    assert!(export_jsonl(&graph, "codex").unwrap().contains("Hello"));
}

#[test]
fn rejects_truncated_binary_archive() {
    let graph = import_jsonl(CLAUDE, "claude").unwrap();
    let mut bytes = encode_binary(&graph).unwrap();
    bytes.pop();
    assert!(decode_binary(&bytes).is_err());
}

#[test]
fn keeps_original_records_when_appending_to_an_imported_session() {
    let mut graph = import_jsonl(CLAUDE, "claude").unwrap();
    graph
        .append_message(
            "user",
            vec![serde_json::json!({"type":"text","text":"Continue"})],
            None,
        )
        .unwrap();
    let exported = export_jsonl(&graph, "claude").unwrap();
    let lines: Vec<serde_json::Value> = exported
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let original: Vec<serde_json::Value> = CLAUDE
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(&lines[..original.len()], original);
    assert!(exported.contains("Continue"));
}

#[test]
fn codex_messages_form_a_reply_chain() {
    let graph = import_jsonl(CODEX, "codex").unwrap();
    let messages = graph.messages().unwrap();
    let reply = graph
        .links
        .iter()
        .find(|link| link.kind == "reply_to")
        .unwrap();
    assert_eq!(reply.source, messages[0].id);
    assert_eq!(reply.target, messages[1].id);
}

#[test]
fn rejects_backward_reply_links() {
    let mut graph = import_jsonl(CODEX, "codex").unwrap();
    let messages = graph.messages().unwrap();
    let first = messages[0].id.clone();
    let second = messages[1].id.clone();
    graph.links.push(Link {
        source: second,
        kind: "reply_to".into(),
        target: first,
    });
    assert!(graph.validate().is_err());
}
