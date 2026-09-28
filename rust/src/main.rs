use link_assistant_conversation::{
    Conversation, decode_binary, decode_lino, encode_binary, encode_lino, export_jsonl,
    import_jsonl,
};
use std::fs;
use std::io::Write;
use std::path::Path;

fn usage() -> &'static str {
    "Usage:\n  link-assistant-conversation import <codex|claude> <session.jsonl> <archive.lino|archive.json|archive.bin>\n  link-assistant-conversation export <codex|claude> <archive> <session.jsonl>\n  link-assistant-conversation convert <codex|claude> <codex|claude> <input.jsonl> <output.jsonl>\n  link-assistant-conversation inspect <archive>\n\nAdd --force to replace an existing output file."
}

fn extension(path: &str) -> Result<&str, String> {
    Path::new(path)
        .extension()
        .and_then(|x| x.to_str())
        .ok_or_else(|| "Archive filename needs an extension".into())
}

fn read_graph(path: &str) -> Result<Conversation, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let graph = match extension(path)? {
        "bin" => decode_binary(&bytes)?,
        "lino" => decode_lino(std::str::from_utf8(&bytes).map_err(|e| e.to_string())?)?,
        "json" => serde_json::from_slice(&bytes).map_err(|e: serde_json::Error| e.to_string())?,
        other => return Err(format!("Unsupported archive extension: {other}")),
    };
    graph.validate()?;
    Ok(graph)
}

fn archive_bytes(graph: &Conversation, path: &str) -> Result<Vec<u8>, String> {
    match extension(path)? {
        "bin" => encode_binary(graph),
        "lino" => Ok(format!("{}\n", encode_lino(graph)?).into_bytes()),
        "json" => Ok(format!(
            "{}\n",
            serde_json::to_string_pretty(graph).map_err(|e| e.to_string())?
        )
        .into_bytes()),
        other => Err(format!("Unsupported archive extension: {other}")),
    }
}

fn write_output(path: &str, bytes: &[u8], force: bool) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .create_new(!force)
        .truncate(force)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())
}

fn run(args: &[String]) -> Result<(), String> {
    if args.is_empty() || args[0] == "--help" || args[0] == "-h" {
        println!("{}", usage());
        return Ok(());
    }
    if args[0] == "--version" || args[0] == "-v" {
        println!("{}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    let force = args.last().is_some_and(|arg| arg == "--force");
    let args = if force { &args[..args.len() - 1] } else { args };
    match args {
        [command, format, input, output] if command == "import" => {
            let source = fs::read_to_string(input).map_err(|e| e.to_string())?;
            let graph = import_jsonl(&source, format)?;
            write_output(output, &archive_bytes(&graph, output)?, force)
        }
        [command, format, input, output] if command == "export" => {
            let graph = read_graph(input)?;
            write_output(output, export_jsonl(&graph, format)?.as_bytes(), force)
        }
        [command, source_format, target_format, input, output] if command == "convert" => {
            let source = fs::read_to_string(input).map_err(|e| e.to_string())?;
            let graph = import_jsonl(&source, source_format)?;
            write_output(
                output,
                export_jsonl(&graph, target_format)?.as_bytes(),
                force,
            )
        }
        [command, input] if command == "inspect" => {
            let graph = read_graph(input)?;
            let root = graph
                .nodes
                .iter()
                .find(|node| node.kind == "conversation")
                .unwrap();
            println!(
                "{}",
                serde_json::json!({"id": root.id, "records": graph.records()?.len(), "messages": graph.messages()?.len()})
            );
            Ok(())
        }
        _ => Err(usage().into()),
    }
}

fn main() {
    if let Err(error) = run(&std::env::args().skip(1).collect::<Vec<_>>()) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
