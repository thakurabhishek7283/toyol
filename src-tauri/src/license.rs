// The license. toyol works on a PC once it has a license key made for that PC,
// with nothing going online: until then the panel shows the PC's code, the
// customer sends it to the seller, and the seller signs a key for it
// (scripts/license.mjs) that they paste in.
//
// The PC's code is a hash of Windows' MachineGuid, so the raw ID never leaves
// the PC, written as 16 characters the customer can read out or retype: 15 of
// the hash and one that checks them. A key is the grant (JSON: which product,
// which PC, who to, and when it ends, if it does) and its Ed25519 signature,
// each base64url, joined by a dot. Only the seller's private key can sign one;
// toyol has the public half, so a key changed by a single character, or made
// for another PC, doesn't work.
//
// Kept in the app's data folder, and checked again at each start.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use sha2::{Digest, Sha256};
use tauri::Manager;

// The public half of the seller's signing key (npm run license -- key prints
// it). Changing it voids every key already given out.
const PUBLIC_KEY: &str = "aTosdrCAyLsvHUdQENlTFyBoWR4bPiORhYertxSsW3s";
// Keys made for something else signed with the same key don't work here
const PRODUCT: &str = "toyol";
// Crockford's base32: no I, L, O or U, so the code reads aloud without mix-ups.
// scripts/license.mjs checks codes with the same alphabet.
const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const FILE: &str = "license.key";

/// Whether toyol is licensed on this PC: the commands that do the work check it
#[derive(Default)]
pub struct License(AtomicBool);

impl License {
    pub fn require(&self) -> Result<(), String> {
        if self.0.load(Ordering::Relaxed) {
            Ok(())
        } else {
            Err("toyol isn't activated on this PC".to_string())
        }
    }
}

/// What the panel shows
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    licensed: bool,
    machine_code: String, // this PC's code, to send for a key
    name: String,         // who it's licensed to
    expires: Option<u64>, // Unix seconds; None: never
    message: String,      // why it isn't licensed, when there's a reason
}

/// What a license key grants: signed by the seller
#[derive(Debug, serde::Deserialize)]
struct Grant {
    product: String,
    machine: String,
    name: String,
    #[serde(default)]
    expires: Option<u64>,
}

/// Check the saved key, if there is one
pub fn check(app: &tauri::AppHandle, license: &License) -> Status {
    let machine = match machine_code() {
        Ok(code) => code,
        Err(e) => return refused(license, "", &e),
    };
    let Some(key) = load(app) else {
        return refused(license, &machine, "");
    };
    match verify(&key, &public_key(), &machine, now()) {
        Ok(grant) => granted(license, machine, grant),
        Err(message) => refused(license, &machine, &message),
    }
}

/// Check a key the customer pasted, and keep it if it's good
pub fn activate(app: &tauri::AppHandle, license: &License, key: &str) -> Result<Status, String> {
    // Email can break a long key over lines
    let key: String = key.split_whitespace().collect();
    if key.is_empty() {
        return Err("Paste your license key.".to_string());
    }
    let machine = machine_code()?;
    let grant = verify(&key, &public_key(), &machine, now())?;
    save(app, &key)?;
    Ok(granted(license, machine, grant))
}

fn verify(key: &str, public_key: &VerifyingKey, machine: &str, now: u64) -> Result<Grant, String> {
    let invalid = || "That isn't a toyol license key. Paste the whole key, exactly as you got it.".to_string();
    let (payload, signature) = key.split_once('.').ok_or_else(invalid)?;
    let payload = URL_SAFE_NO_PAD.decode(payload).map_err(|_| invalid())?;
    let signature = URL_SAFE_NO_PAD.decode(signature).map_err(|_| invalid())?;
    let signature = Signature::from_slice(&signature).map_err(|_| invalid())?;
    public_key.verify_strict(&payload, &signature).map_err(|_| invalid())?;

    let grant: Grant = serde_json::from_slice(&payload).map_err(|_| invalid())?;
    if grant.product != PRODUCT {
        return Err(invalid());
    }
    if grant.machine != machine {
        return Err(format!(
            "This license key is for another PC ({}). Send this PC's code to get a key for it.",
            grant.machine
        ));
    }
    if grant.expires.is_some_and(|at| now >= at) {
        return Err("This license key has expired. Send this PC's code to get a new one.".to_string());
    }
    Ok(grant)
}

fn public_key() -> VerifyingKey {
    let bytes: [u8; 32] = URL_SAFE_NO_PAD
        .decode(PUBLIC_KEY)
        .ok()
        .and_then(|b| b.try_into().ok())
        .expect("PUBLIC_KEY is 32 bytes, base64url");
    VerifyingKey::from_bytes(&bytes).expect("PUBLIC_KEY is an Ed25519 key")
}

fn granted(license: &License, machine: String, grant: Grant) -> Status {
    license.0.store(true, Ordering::Relaxed);
    Status { licensed: true, machine_code: machine, name: grant.name, expires: grant.expires, message: String::new() }
}

fn refused(license: &License, machine: &str, message: &str) -> Status {
    license.0.store(false, Ordering::Relaxed);
    Status {
        licensed: false,
        machine_code: machine.to_string(),
        name: String::new(),
        expires: None,
        message: message.to_string(),
    }
}

/// This PC's code
pub fn machine_code() -> Result<String, String> {
    #[cfg(windows)]
    let id = win::machine_guid()?;
    #[cfg(not(windows))]
    let id = fs::read_to_string("/etc/machine-id").map_err(|e| e.to_string())?;
    Ok(code_for(&id))
}

/// The code for a machine ID: XXXX-XXXX-XXXX-XXXX, the last character a check
fn code_for(id: &str) -> String {
    let hash = Sha256::digest(format!("toyol:{}", id.trim()));
    // The hash's first 75 bits, 5 to a character
    let body: String = (0..15)
        .map(|i| {
            let bit = i * 5;
            let pair = u16::from(hash[bit / 8]) << 8 | u16::from(hash[bit / 8 + 1]);
            ALPHABET[usize::from(pair >> (11 - bit % 8) & 31)] as char
        })
        .collect();
    let check = ALPHABET[usize::from(Sha256::digest(&body)[0] % 32)] as char;
    let code: Vec<char> = body.chars().chain([check]).collect();
    code.chunks(4).map(|group| group.iter().collect::<String>()).collect::<Vec<_>>().join("-")
}

fn path(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_local_data_dir().unwrap_or_default().join(FILE)
}

fn load(app: &tauri::AppHandle) -> Option<String> {
    fs::read_to_string(path(app)).ok().map(|key| key.trim().to_string())
}

fn save(app: &tauri::AppHandle, key: &str) -> Result<(), String> {
    let path = path(app);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&path, key).map_err(|e| format!("Couldn't save the license key: {}", e))
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    // A key scripts/license.mjs signed with the test key below (seed [7; 32]),
    // for the PC with ID "test-pc", to Test Customer: so the two stay in step
    const SIGNED_BY_SCRIPT: &str = "eyJwcm9kdWN0IjoidG95b2wiLCJtYWNoaW5lIjoiODY2Ti1QN0pILTIxRkctMTJFWSIsIm5hbWUiOiJUZXN0IEN1c3RvbWVyIn0._RZ1FYjsoZoZvbPGvk02mOVHue-rK5AjTljKrd2RAxBpEnWnUK8fZYW43vg1NB3rfvLyJw43Gte70sczunDXBg";
    const TEST_PC: &str = "866N-P7JH-21FG-12EY";

    fn test_key() -> SigningKey {
        SigningKey::from_bytes(&[7; 32])
    }

    fn make(grant: &str) -> String {
        let signature = test_key().sign(grant.as_bytes());
        format!("{}.{}", URL_SAFE_NO_PAD.encode(grant), URL_SAFE_NO_PAD.encode(signature.to_bytes()))
    }

    #[test]
    fn the_public_key_is_valid() {
        public_key();
    }

    #[test]
    fn codes_are_stable_and_checked() {
        let code = code_for("test-pc");
        assert_eq!(code, TEST_PC);
        assert_eq!(code, code_for(" test-pc\n"));
        assert_ne!(code, code_for("another-pc"));
        assert!(machine_code().unwrap().len() == 19);
    }

    #[test]
    fn takes_a_key_from_the_script() {
        let grant = verify(SIGNED_BY_SCRIPT, &test_key().verifying_key(), TEST_PC, now()).unwrap();
        assert_eq!(grant.name, "Test Customer");
        assert_eq!(grant.expires, None);
    }

    #[test]
    fn takes_only_this_pcs_unexpired_key_for_toyol() {
        let public = test_key().verifying_key();
        let grant = |machine: &str, product: &str, expires: &str| {
            make(&format!(r#"{{"product":"{}","machine":"{}","name":"A"{}}}"#, product, machine, expires))
        };
        assert!(verify(&grant(TEST_PC, "toyol", ""), &public, TEST_PC, 1000).is_ok());
        assert!(verify(&grant(TEST_PC, "toyol", r#","expires":2000"#), &public, TEST_PC, 1000).is_ok());

        let expired = verify(&grant(TEST_PC, "toyol", r#","expires":2000"#), &public, TEST_PC, 2000);
        assert!(expired.unwrap_err().contains("expired"));
        let elsewhere = verify(&grant(TEST_PC, "toyol", ""), &public, &code_for("another-pc"), 1000);
        assert!(elsewhere.unwrap_err().contains("another PC"));
        assert!(verify(&grant(TEST_PC, "other", ""), &public, TEST_PC, 1000).is_err());
    }

    #[test]
    fn refuses_keys_not_signed_by_the_seller() {
        let key = make(&format!(r#"{{"product":"toyol","machine":"{}","name":"A"}}"#, TEST_PC));
        // Signed with another key
        assert!(verify(&key, &public_key(), TEST_PC, 0).is_err());
        // Changed after signing: the name, here
        let (_, signature) = key.split_once('.').unwrap();
        let changed = URL_SAFE_NO_PAD.encode(format!(r#"{{"product":"toyol","machine":"{}","name":"B"}}"#, TEST_PC));
        assert!(verify(&format!("{}.{}", changed, signature), &test_key().verifying_key(), TEST_PC, 0).is_err());
        // Not a key at all
        assert!(verify("hello", &public_key(), TEST_PC, 0).is_err());
        assert!(verify("a.b", &public_key(), TEST_PC, 0).is_err());
    }
}

#[cfg(windows)]
mod win {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ, RRF_SUBKEY_WOW6464KEY};

    /// The ID Windows gives this installation (HKLM\SOFTWARE\Microsoft\Cryptography).
    /// Reinstalling Windows changes it, and with it the PC's code.
    pub fn machine_guid() -> Result<String, String> {
        let mut buffer = [0u16; 64];
        let mut size = (buffer.len() * 2) as u32;
        let result = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                w!("SOFTWARE\\Microsoft\\Cryptography"),
                w!("MachineGuid"),
                RRF_RT_REG_SZ | RRF_SUBKEY_WOW6464KEY,
                None,
                Some(buffer.as_mut_ptr().cast()),
                Some(&mut size),
            )
        };
        if result.is_err() {
            return Err(format!("Couldn't read this PC's ID ({:?})", result));
        }
        let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
        Ok(String::from_utf16_lossy(&buffer[..len]))
    }
}
