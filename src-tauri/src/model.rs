// The speech model (~820 MB) doesn't ship in the installer: it's downloaded on
// first use into the app's data folder, so installers and updates stay small
// and an update keeps it. Pinned to a revision and checked against its
// SHA-256, like scripts/fetch-models.mjs, which keeps the copy development
// builds use; a dropped download resumes.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use std::thread;
use std::time::Duration;

use reqwest::blocking::Client;
use reqwest::header::RANGE;
use reqwest::StatusCode;
use sha2::{Digest, Sha256};

// Whisper medium.en, 8-bit: see scripts/fetch-models.mjs for why. Keep these in sync with it.
pub const FILE: &str = "ggml-medium.en-q8_0.bin";
const URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-medium.en-q8_0.bin";
const SHA256: &str = "43fa2cd084de5a04399a896a9a7a786064e221365c01700cea4666005218f11c";

// Each attempt resumes, so a flaky connection still gets there
const ATTEMPTS: u32 = 40;
const RETRY_AFTER: Duration = Duration::from_secs(3);

/// Download the model to `path` unless it's there already (only a checked
/// download gets that name). `progress` gets the bytes so far and the total.
pub fn ensure(path: &Path, mut progress: impl FnMut(u64, u64)) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("Couldn't make {}: {}", dir.display(), e))?;
    }
    let partial = path.with_extension("bin.partial");
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(None::<Duration>) // the whole download takes minutes
        .build()
        .map_err(|e| e.to_string())?;

    let mut attempt = 1;
    while let Err(e) = fetch(&client, &partial, &mut progress) {
        if attempt == ATTEMPTS {
            return Err(format!("Couldn't download the speech model: {}", e));
        }
        log::warn!("Speech model download stopped ({}), resuming", e);
        attempt += 1;
        thread::sleep(RETRY_AFTER);
    }

    let actual = sha256(&partial)?;
    if actual != SHA256 {
        let _ = fs::remove_file(&partial);
        return Err(format!("The speech model download was damaged (SHA-256 {}). Try again.", actual));
    }
    fs::rename(&partial, path).map_err(|e| e.to_string())
}

// Download to `partial`, carrying on from what's there
fn fetch(client: &Client, partial: &Path, progress: &mut impl FnMut(u64, u64)) -> Result<(), String> {
    let have = fs::metadata(partial).map(|m| m.len()).unwrap_or(0);
    let mut request = client.get(URL);
    if have > 0 {
        request = request.header(RANGE, format!("bytes={}-", have));
    }
    let mut response = request.send().map_err(|e| e.to_string())?;
    if response.status() == StatusCode::RANGE_NOT_SATISFIABLE {
        return Ok(()); // already complete
    }
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    // 200 to a range request means the server is sending the whole file again
    let resume = have > 0 && response.status() == StatusCode::PARTIAL_CONTENT;
    let mut received = if resume { have } else { 0 };
    let total = received + response.content_length().unwrap_or(0);
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .append(resume)
        .truncate(!resume)
        .open(partial)
        .map_err(|e| e.to_string())?;

    let mut buffer = vec![0; 1 << 16];
    loop {
        let n = response.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        file.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
        received += n as u64;
        progress(received, total);
    }
    if received < total {
        return Err(format!("cut short at {} MB", received / 1_000_000));
    }
    Ok(())
}

fn sha256(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0; 1 << 20];
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
