// The app's speech engine (src/speech.rs) without the app, for
// scripts/bench-speech.mjs:
//
//   cargo run --release --example speech -- <model.bin>
//
// Requests come in on stdin: a JSON line, then for a pass the audio (u32 LE
// sample count, then 16 kHz mono f32 LE samples).
//   {"id":1,"type":"pass","prompt":"...","max_tokens":60,"final":true}
//   {"type":"cancel"}   stops the passes started so far, like speech_cancel
// Each pass is answered on stdout: {"id":1,"text":"...","ms":250}. Passes run
// one at a time in order; a cancel takes effect at once.

use std::io::{BufRead, BufReader, Read, Write};
use std::sync::{mpsc, Arc};
use std::time::Instant;

use app_lib::speech::{Pass, Speech};
use serde_json::{json, Value};

fn main() {
    let model = std::env::args().nth(1).expect("usage: speech <model.bin>");
    let speech = Arc::new(Speech::default());
    let device = speech.load(std::path::Path::new(&model)).expect("load");
    eprintln!("speech model ready on {}", device);

    let (send, receive) = mpsc::channel::<(Value, Vec<f32>)>();
    let worker = {
        let speech = Arc::clone(&speech);
        std::thread::spawn(move || {
            for (request, audio) in receive {
                let began = Instant::now();
                let pass = Pass {
                    audio: &audio,
                    prompt: request["prompt"].as_str().unwrap_or(""),
                    max_tokens: request["max_tokens"].as_i64().unwrap_or(220) as i32,
                    final_pass: request["final"].as_bool().unwrap_or(true),
                };
                let reply = match speech.transcribe(&pass) {
                    Ok(text) => json!({ "id": request["id"], "text": text, "ms": began.elapsed().as_millis() as u64 }),
                    Err(error) => json!({ "id": request["id"], "error": error }),
                };
                let mut out = std::io::stdout().lock();
                writeln!(out, "{}", reply).unwrap();
                out.flush().unwrap();
            }
        })
    };

    let mut input = BufReader::new(std::io::stdin().lock());
    let mut line = String::new();
    while input.read_line(&mut line).unwrap_or(0) > 0 {
        let request: Value = serde_json::from_str(line.trim()).expect("a JSON request");
        line.clear();
        match request["type"].as_str() {
            Some("cancel") => speech.cancel(),
            Some("pass") => {
                let mut count = [0u8; 4];
                input.read_exact(&mut count).unwrap();
                let mut bytes = vec![0u8; u32::from_le_bytes(count) as usize * 4];
                input.read_exact(&mut bytes).unwrap();
                let audio = bytes.chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect();
                send.send((request, audio)).unwrap();
            }
            other => panic!("unknown request type {:?}", other),
        }
    }
    drop(send);
    worker.join().unwrap();
}
