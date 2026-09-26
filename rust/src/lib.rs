//! A portable, linked archive for agent conversations.

use lino_objects_codec::{LinoValue, decode, encode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

const SCHEMA: &str = "link-assistant-conversation/v1";
const MAGIC: &[u8; 8] = b"LACB0001";
const RELATIONS: [&str; 3] = ["contains", "precedes", "reply_to"];

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Conversation {
    pub schema: String,
    pub nodes: Vec<Node>,
    pub links: Vec<Link>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Node {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(rename = "sourceFormat", skip_serializing_if = "Option::is_none")]
    pub source_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Vec<Value>>,
    #[serde(rename = "nativeFormat", skip_serializing_if = "Option::is_none")]
    pub native_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct Link {
    pub source: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub target: String,
}

impl Conversation {
    pub fn new(id: &str, source_format: Option<&str>) -> Result<Self, String> {
        if id.is_empty() {
            return Err("Conversation id must be nonempty".into());
        }
        Ok(Self {
            schema: SCHEMA.into(),
            nodes: vec![Node {
                id: id.into(),
                kind: "conversation".into(),
                source_format: source_format.map(str::to_owned),
                role: None,
                content: None,
                native_format: None,
                original: None,
            }],
            links: Vec::new(),
        })
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.schema != SCHEMA {
            return Err(format!("Expected {SCHEMA}"));
        }
        let mut ids = HashMap::new();
        let mut roots = Vec::new();
        for (index, node) in self.nodes.iter().enumerate() {
            if node.id.is_empty() || ids.insert(node.id.as_str(), index).is_some() {
                return Err("Empty or duplicate node id".into());
            }
            match node.kind.as_str() {
                "conversation" => roots.push(index),
                "message" | "event" => (),
                _ => return Err(format!("Unknown node type: {}", node.kind)),
            }
        }
        if roots.len() != 1 {
            return Err("Conversation needs exactly one root node".into());
        }
        let root = &self.nodes[roots[0]].id;
        let mut contains = HashSet::new();
        let mut preceding = HashSet::new();
        let mut following = HashSet::new();
        let mut replies = Vec::new();
        for link in &self.links {
            let source = ids.get(link.source.as_str()).copied();
            let target = ids.get(link.target.as_str()).copied();
            if source.is_none() || target.is_none() || !RELATIONS.contains(&link.kind.as_str()) {
                return Err("Invalid link or missing link endpoint".into());
            }
            match link.kind.as_str() {
                "contains" => {
                    if &link.source != root
                        || &link.target == root
                        || !contains.insert(&link.target)
                    {
                        return Err("Invalid or duplicate contains link".into());
                    }
                }
                "precedes" => {
                    if !preceding.insert(&link.source) || !following.insert(&link.target) {
                        return Err("Record order must form one chain".into());
                    }
                }
                "reply_to" => {
                    if self.nodes[source.unwrap()].kind != "message"
                        || self.nodes[target.unwrap()].kind != "message"
                    {
                        return Err("Reply links must connect messages".into());
                    }
                    replies.push(link);
                }
                _ => unreachable!(),
            }
        }
        if contains.len() != self.nodes.len() - 1
            || preceding.len() != contains.len().saturating_sub(1)
        {
            return Err("Conversation records are disconnected".into());
        }
        let positions: HashMap<&str, usize> = self
            .ordered_indices_unchecked()?
            .iter()
            .enumerate()
            .map(|(position, &index)| (self.nodes[index].id.as_str(), position))
            .collect();
        let mut reply_children = HashSet::new();
        for reply in replies {
            if positions[reply.source.as_str()] >= positions[reply.target.as_str()]
                || !reply_children.insert(&reply.target)
            {
                return Err("Reply links need an earlier, unique parent".into());
            }
        }
        Ok(())
    }

    fn ordered_indices_unchecked(&self) -> Result<Vec<usize>, String> {
        let ids: HashMap<&str, usize> = self
            .nodes
            .iter()
            .enumerate()
            .map(|(i, n)| (n.id.as_str(), i))
            .collect();
        let members: HashSet<&str> = self
            .links
            .iter()
            .filter(|l| l.kind == "contains")
            .map(|l| l.target.as_str())
            .collect();
        if members.is_empty() {
            return Ok(Vec::new());
        }
        let next: HashMap<&str, &str> = self
            .links
            .iter()
            .filter(|l| l.kind == "precedes")
            .map(|l| (l.source.as_str(), l.target.as_str()))
            .collect();
        let targets: HashSet<&str> = next.values().copied().collect();
        let first = members
            .iter()
            .find(|id| !targets.contains(**id))
            .copied()
            .ok_or("Record order has no start")?;
        let mut result = Vec::new();
        let mut current = Some(first);
        while let Some(id) = current {
            if result.len() >= members.len() || !members.contains(id) {
                return Err("Record order has a cycle".into());
            }
            result.push(ids[id]);
            current = next.get(id).copied();
        }
        if result.len() != members.len() {
            return Err("Conversation record order is disconnected".into());
        }
        Ok(result)
    }

    pub fn records(&self) -> Result<Vec<&Node>, String> {
        self.validate()?;
        Ok(self
            .ordered_indices_unchecked()?
            .iter()
            .map(|&i| &self.nodes[i])
            .collect())
    }

    pub fn messages(&self) -> Result<Vec<&Node>, String> {
        Ok(self
            .records()?
            .into_iter()
            .filter(|node| node.kind == "message")
            .collect())
    }

    pub fn append_message(
        &mut self,
        role: &str,
        content: Vec<Value>,
        parent_id: Option<&str>,
    ) -> Result<String, String> {
        if !["system", "developer", "user", "assistant", "tool"].contains(&role) {
            return Err(format!("Unsupported message role: {role}"));
        }
        let id = format!("record:{}", self.nodes.len());
        let node = Node {
            id: id.clone(),
            kind: "message".into(),
            source_format: None,
            role: Some(role.into()),
            content: Some(content),
            native_format: None,
            original: None,
        };
        self.append_node(node, parent_id)?;
        Ok(id)
    }

    fn append_node(&mut self, node: Node, parent_id: Option<&str>) -> Result<(), String> {
        self.validate()?;
        if self.nodes.iter().any(|n| n.id == node.id) {
            return Err(format!("Duplicate node id: {}", node.id));
        }
        if let Some(parent) = parent_id {
            if !self
                .nodes
                .iter()
                .any(|n| n.id == parent && n.kind == "message")
            {
                return Err(format!("Unknown parent message: {parent}"));
            }
        }
        let previous = self.records()?.last().map(|n| n.id.clone());
        let root = self
            .nodes
            .iter()
            .find(|n| n.kind == "conversation")
            .unwrap()
            .id
            .clone();
        self.links.push(Link {
            source: root,
            kind: "contains".into(),
            target: node.id.clone(),
        });
        if let Some(previous) = previous {
            self.links.push(Link {
                source: previous,
                kind: "precedes".into(),
                target: node.id.clone(),
            });
        }
        if let Some(parent) = parent_id {
            self.links.push(Link {
                source: parent.into(),
                kind: "reply_to".into(),
                target: node.id.clone(),
            });
        }
        self.nodes.push(node);
        self.validate()
    }
}

fn normalize_codex(record: &Value) -> Option<(String, Vec<Value>)> {
    if record.get("type")?.as_str()? != "response_item" {
        return None;
    }
    let payload = record.get("payload")?;
    match payload.get("type")?.as_str()? {
        "message" => {
            let role = payload.get("role")?.as_str()?.to_owned();
            let blocks = payload.get("content")?.as_array()?;
            let content = blocks
                .iter()
                .map(|block| {
                    block
                        .get("text")
                        .and_then(Value::as_str)
                        .map(|text| json!({"type":"text","text":text}))
                        .unwrap_or_else(|| json!({"type":"native","value":block}))
                })
                .collect();
            Some((role, content))
        }
        "function_call" => Some((
            "assistant".into(),
            vec![json!({
                "type":"tool_call", "name":payload.get("name"),
                "arguments":payload.get("arguments"), "callId":payload.get("call_id")
            })],
        )),
        "function_call_output" => Some((
            "tool".into(),
            vec![json!({
                "type":"tool_result", "callId":payload.get("call_id"),
                "content":payload.get("output")
            })],
        )),
        _ => None,
    }
}

fn normalize_claude(record: &Value) -> Option<(String, Vec<Value>)> {
    let kind = record.get("type")?.as_str()?;
    if kind != "user" && kind != "assistant" {
        return None;
    }
    let message = record.get("message")?;
    let role = message.get("role")?.as_str()?;
    let raw = message.get("content")?;
    let blocks = if let Some(text) = raw.as_str() {
        vec![json!({"type":"text","text":text})]
    } else {
        raw.as_array()?.clone()
    };
    let content: Vec<Value> = blocks.iter().map(|block| match block.get("type").and_then(Value::as_str) {
        Some("tool_use") => json!({"type":"tool_call","name":block.get("name"),"arguments":block.get("input"),"callId":block.get("id")}),
        Some("tool_result") => json!({"type":"tool_result","callId":block.get("tool_use_id"),"content":block.get("content")}),
        Some("text") => json!({"type":"text","text":block.get("text")}),
        _ => json!({"type":"native","value":block}),
    }).collect();
    let role = if !content.is_empty() && content.iter().all(|b| b["type"] == "tool_result") {
        "tool"
    } else {
        role
    };
    Some((role.into(), content))
}

pub fn import_jsonl(text: &str, format: &str) -> Result<Conversation, String> {
    if format != "codex" && format != "claude" {
        return Err(format!("Unsupported source format: {format}"));
    }
    let mut source = Vec::new();
    for (line_number, line) in text.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let record: Value = serde_json::from_str(line)
            .map_err(|e| format!("Invalid JSONL at line {}: {e}", line_number + 1))?;
        if !record.is_object() {
            return Err(format!(
                "Invalid JSONL at line {}: expected an object",
                line_number + 1
            ));
        }
        source.push(record);
    }
    let id = source
        .iter()
        .find_map(|record| {
            if format == "codex" {
                (record["type"] == "session_meta")
                    .then(|| record["payload"]["id"].as_str())
                    .flatten()
            } else {
                record["sessionId"].as_str()
            }
        })
        .unwrap_or("conversation");
    let mut graph = Conversation::new(id, Some(format))?;
    let mut native_ids = HashMap::new();
    let mut pending = Vec::new();
    let mut previous_codex_message: Option<String> = None;
    for original in source {
        let normalized = if format == "codex" {
            normalize_codex(&original)
        } else {
            normalize_claude(&original)
        };
        let is_message = normalized.is_some();
        let id = format!("record:{}", graph.nodes.len());
        let node = Node {
            id: id.clone(),
            kind: if is_message { "message" } else { "event" }.into(),
            source_format: None,
            role: normalized.as_ref().map(|x| x.0.clone()),
            content: normalized.map(|x| x.1),
            native_format: Some(format.into()),
            original: Some(original.clone()),
        };
        graph.append_node(
            node,
            if format == "codex" && is_message {
                previous_codex_message.as_deref()
            } else {
                None
            },
        )?;
        if format == "codex" && is_message {
            previous_codex_message = Some(id.clone());
        }
        if format == "claude" && graph.nodes.last().unwrap().kind == "message" {
            if let Some(uuid) = original["uuid"].as_str() {
                native_ids
                    .entry(uuid.to_owned())
                    .or_insert_with(|| id.clone());
            }
            if let Some(parent) = original["parentUuid"].as_str() {
                pending.push((id, parent.to_owned()));
            }
        }
    }
    for (child, native_parent) in pending {
        if let Some(parent) = native_ids.get(&native_parent) {
            if parent != &child {
                graph.links.push(Link {
                    source: parent.clone(),
                    kind: "reply_to".into(),
                    target: child,
                });
            }
        }
    }
    graph.validate()?;
    Ok(graph)
}

fn synthetic_codex(node: &Node) -> Result<Vec<Value>, String> {
    let mut output = Vec::new();
    let mut text = Vec::new();
    for block in node.content.as_ref().ok_or("Message has no content")? {
        match block["type"].as_str().unwrap_or("") {
            "text" => text.push(json!({"type":if node.role.as_deref() == Some("user") {"input_text"} else {"output_text"},"text":block["text"]})),
            "tool_call" => output.push(json!({"type":"response_item","payload":{
                "type":"function_call","name":block["name"],
                "arguments":block["arguments"].as_str().map(str::to_owned).unwrap_or_else(|| block["arguments"].to_string()),
                "call_id":block["callId"]
            }})),
            "tool_result" => output.push(json!({"type":"response_item","payload":{
                "type":"function_call_output","call_id":block["callId"],
                "output":block["content"].as_str().map(str::to_owned).unwrap_or_else(|| block["content"].to_string())
            }})),
            other => return Err(format!("Cannot export {other} content to Codex")),
        }
    }
    if !text.is_empty() || output.is_empty() {
        output.insert(
            0,
            json!({"type":"response_item","payload":{
                "type":"message","role":node.role,"content":text
            }}),
        );
    }
    Ok(output)
}

fn synthetic_claude(
    node: &Node,
    uuid: &str,
    parent: Option<&str>,
    session: &str,
) -> Result<Value, String> {
    let mut content = Vec::new();
    for block in node.content.as_ref().ok_or("Message has no content")? {
        content.push(match block["type"].as_str().unwrap_or("") {
            "text" => json!({"type":"text","text":block["text"]}),
            "tool_call" => {
                let input = block["arguments"].as_str().map(|s| serde_json::from_str::<Value>(s).unwrap_or_else(|_| json!({"raw":s}))).unwrap_or_else(|| block["arguments"].clone());
                json!({"type":"tool_use","id":block["callId"],"name":block["name"],"input":input})
            }
            "tool_result" => json!({"type":"tool_result","tool_use_id":block["callId"],"content":block["content"]}),
            other => return Err(format!("Cannot export {other} content to Claude Code")),
        });
    }
    let role = if node.role.as_deref() == Some("tool") {
        "user"
    } else {
        node.role.as_deref().unwrap_or("")
    };
    if role != "user" && role != "assistant" {
        return Err(format!("Cannot export {role} role to Claude Code"));
    }
    Ok(
        json!({"type":role,"uuid":uuid,"parentUuid":parent,"sessionId":session,"message":{"role":role,"content":content}}),
    )
}

pub fn export_jsonl(graph: &Conversation, format: &str) -> Result<String, String> {
    if format != "codex" && format != "claude" {
        return Err(format!("Unsupported target format: {format}"));
    }
    let records = graph.records()?;
    let session = records
        .iter()
        .find_map(|node| {
            (node.native_format.as_deref() == Some("claude"))
                .then(|| {
                    node.original
                        .as_ref()?
                        .get("sessionId")?
                        .as_str()
                        .map(str::to_owned)
                })
                .flatten()
        })
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let has_session_meta = records.iter().any(|node| {
        node.native_format.as_deref() == Some("codex")
            && node
                .original
                .as_ref()
                .is_some_and(|record| record["type"] == "session_meta")
    });
    let mut output = Vec::new();
    if format == "codex" && !has_session_meta {
        output.push(json!({"type":"session_meta","payload":{"id":session}}));
    }
    let parents: HashMap<&str, &str> = graph
        .links
        .iter()
        .filter(|l| l.kind == "reply_to")
        .map(|l| (l.target.as_str(), l.source.as_str()))
        .collect();
    let mut uuids = HashMap::new();
    for node in records {
        if node.native_format.as_deref() == Some(format) {
            if let Some(original) = &node.original {
                if format == "claude" && node.kind == "message" {
                    if let Some(uuid) = original["uuid"].as_str() {
                        uuids.insert(node.id.as_str(), uuid.to_owned());
                    }
                }
                output.push(original.clone());
                continue;
            }
        }
        if node.kind != "message" {
            continue;
        }
        if format == "codex" {
            output.extend(synthetic_codex(node)?);
        } else {
            let uuid = uuid::Uuid::new_v4().to_string();
            let parent = parents
                .get(node.id.as_str())
                .and_then(|id| uuids.get(id))
                .map(String::as_str);
            output.push(synthetic_claude(node, &uuid, parent, &session)?);
            uuids.insert(node.id.as_str(), uuid);
        }
    }
    if output.is_empty() {
        return Ok(String::new());
    }
    Ok(format!(
        "{}\n",
        output
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n")
    ))
}

fn to_lino(value: &Value) -> Result<LinoValue, String> {
    match value {
        Value::Null => Ok(LinoValue::Null),
        Value::Bool(v) => Ok(LinoValue::Bool(*v)),
        Value::Number(v) => v
            .as_i64()
            .map(LinoValue::Int)
            .or_else(|| v.as_f64().map(LinoValue::Float))
            .ok_or("Unsupported JSON number".into()),
        Value::String(v) => Ok(LinoValue::String(v.clone())),
        Value::Array(items) => Ok(LinoValue::Array(
            items.iter().map(to_lino).collect::<Result<_, _>>()?,
        )),
        Value::Object(fields) => Ok(LinoValue::Object(
            fields
                .iter()
                .map(|(key, value)| Ok((key.clone(), to_lino(value)?)))
                .collect::<Result<_, String>>()?,
        )),
    }
}

fn from_lino(value: &LinoValue) -> Result<Value, String> {
    match value {
        LinoValue::Null => Ok(Value::Null),
        LinoValue::Bool(v) => Ok(Value::Bool(*v)),
        LinoValue::Int(v) => Ok(Value::from(*v)),
        LinoValue::Float(v) => serde_json::Number::from_f64(*v)
            .map(Value::Number)
            .ok_or("Invalid floating point value".into()),
        LinoValue::String(v) => Ok(Value::String(v.clone())),
        LinoValue::Array(items) => Ok(Value::Array(
            items.iter().map(from_lino).collect::<Result<_, _>>()?,
        )),
        LinoValue::Object(fields) => {
            let mut map = serde_json::Map::new();
            for (key, value) in fields {
                map.insert(key.clone(), from_lino(value)?);
            }
            Ok(Value::Object(map))
        }
    }
}

pub fn encode_lino(graph: &Conversation) -> Result<String, String> {
    graph.validate()?;
    let value = serde_json::to_value(graph).map_err(|e| e.to_string())?;
    Ok(encode(&to_lino(&value)?))
}

pub fn decode_lino(text: &str) -> Result<Conversation, String> {
    let value = from_lino(&decode(text).map_err(|e| e.to_string())?)?;
    let graph: Conversation = serde_json::from_value(value).map_err(|e| e.to_string())?;
    graph.validate()?;
    Ok(graph)
}

pub fn encode_binary(graph: &Conversation) -> Result<Vec<u8>, String> {
    graph.validate()?;
    let nodes: Vec<Vec<u8>> = graph
        .nodes
        .iter()
        .map(|node| serde_json::to_vec(node).map_err(|e| e.to_string()))
        .collect::<Result<_, _>>()?;
    let indexes: HashMap<&str, u32> = graph
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id.as_str(), i as u32))
        .collect();
    let mut bytes = Vec::new();
    bytes.extend(MAGIC);
    bytes.extend(
        u32::try_from(nodes.len())
            .map_err(|e| e.to_string())?
            .to_le_bytes(),
    );
    bytes.extend(
        u32::try_from(graph.links.len())
            .map_err(|e| e.to_string())?
            .to_le_bytes(),
    );
    for node in nodes {
        bytes.extend(
            u32::try_from(node.len())
                .map_err(|e| e.to_string())?
                .to_le_bytes(),
        );
        bytes.extend(node);
    }
    for link in &graph.links {
        bytes.extend(indexes[link.source.as_str()].to_le_bytes());
        bytes.push(
            (RELATIONS
                .iter()
                .position(|kind| *kind == link.kind)
                .unwrap()
                + 1) as u8,
        );
        bytes.extend(indexes[link.target.as_str()].to_le_bytes());
    }
    Ok(bytes)
}

fn read_u32(bytes: &[u8], offset: &mut usize) -> Result<u32, String> {
    let end = offset.checked_add(4).ok_or("Binary offset overflow")?;
    let data: [u8; 4] = bytes
        .get(*offset..end)
        .ok_or("Truncated binary archive")?
        .try_into()
        .unwrap();
    *offset = end;
    Ok(u32::from_le_bytes(data))
}

pub fn decode_binary(bytes: &[u8]) -> Result<Conversation, String> {
    if bytes.len() < 16 || &bytes[..8] != MAGIC {
        return Err("Invalid conversation binary header".into());
    }
    let mut offset = 8;
    let node_count = read_u32(bytes, &mut offset)? as usize;
    let link_count = read_u32(bytes, &mut offset)? as usize;
    if node_count > (bytes.len() - 16) / 4 || link_count > bytes.len() / 9 {
        return Err("Invalid conversation binary counts".into());
    }
    let mut nodes = Vec::with_capacity(node_count);
    for _ in 0..node_count {
        let size = read_u32(bytes, &mut offset)? as usize;
        let end = offset.checked_add(size).ok_or("Binary offset overflow")?;
        let data = bytes.get(offset..end).ok_or("Truncated binary node")?;
        nodes.push(serde_json::from_slice::<Node>(data).map_err(|e| e.to_string())?);
        offset = end;
    }
    let mut links = Vec::with_capacity(link_count);
    for _ in 0..link_count {
        let source = read_u32(bytes, &mut offset)? as usize;
        let relation = *bytes.get(offset).ok_or("Truncated binary link")?;
        offset += 1;
        let target = read_u32(bytes, &mut offset)? as usize;
        let kind = RELATIONS
            .get(relation.wrapping_sub(1) as usize)
            .ok_or("Invalid binary relation")?;
        links.push(Link {
            source: nodes.get(source).ok_or("Invalid binary source")?.id.clone(),
            kind: (*kind).into(),
            target: nodes.get(target).ok_or("Invalid binary target")?.id.clone(),
        });
    }
    if offset != bytes.len() {
        return Err("Trailing data in binary conversation".into());
    }
    let graph = Conversation {
        schema: SCHEMA.into(),
        nodes,
        links,
    };
    graph.validate()?;
    Ok(graph)
}
