use std::fs;
use std::process::Command;

#[test]
fn converts_claude_session_through_binary_archive() {
    let folder = tempfile::tempdir().unwrap();
    let source = folder.path().join("source.jsonl");
    let archive = folder.path().join("archive.bin");
    let output = folder.path().join("codex.jsonl");
    fs::write(
        &source,
        "{\"type\":\"user\",\"uuid\":\"u1\",\"parentUuid\":null,\"sessionId\":\"s1\",\"message\":{\"role\":\"user\",\"content\":\"Hello\"}}\n",
    )
    .unwrap();
    let exe = env!("CARGO_BIN_EXE_link-assistant-conversation");
    assert!(
        Command::new(exe)
            .args(["import", "claude"])
            .arg(&source)
            .arg(&archive)
            .status()
            .unwrap()
            .success()
    );
    assert!(
        Command::new(exe)
            .args(["export", "codex"])
            .arg(&archive)
            .arg(&output)
            .status()
            .unwrap()
            .success()
    );
    assert!(fs::read_to_string(&output).unwrap().contains("Hello"));
    assert!(
        !Command::new(exe)
            .args(["export", "codex"])
            .arg(&archive)
            .arg(&output)
            .status()
            .unwrap()
            .success()
    );
}
