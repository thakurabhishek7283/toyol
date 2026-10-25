// Speech to text on this PC, with whisper.cpp. The model ships with the app
// (scripts/fetch-models.mjs) and runs on the GPU through Vulkan, which every
// graphics driver provides, or on the CPU if there's no usable GPU. Audio never
// leaves the machine.
//
// The web side streams: while the user talks it sends the unfinished part of
// the recording again and again for live text, then the rest once they stop
// (src/lib/speech/live.ts). So a pass must be quick, and a pass that's no
// longer wanted can be cancelled.

use std::ffi::{c_char, c_void, CStr, CString};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use whisper_rs_sys as sys;

pub const SAMPLE_RATE: usize = 16000;
// Whisper's window: a pass takes at most this much audio
const MAX_SECONDS: usize = 30;

struct Model {
    ctx: *mut sys::whisper_context,
    state: *mut sys::whisper_state,
}

// The pointers are only used while the Speech mutex is held
unsafe impl Send for Model {}

impl Drop for Model {
    fn drop(&mut self) {
        unsafe {
            sys::whisper_free_state(self.state);
            sys::whisper_free(self.ctx);
        }
    }
}

/// One pass of recognition
pub struct Pass<'a> {
    pub audio: &'a [f32], // 16 kHz mono, at most 30 s
    pub prompt: &'a str,  // vocabulary and earlier text, steering spelling (see src/lib/speech/transcript.ts)
    pub max_tokens: i32,  // a cap, so a looping decode stops early
    pub final_pass: bool, // the text that gets sent: worth retrying if the decode goes wrong
}

/// The loaded model, shared by every request; one pass at a time
pub struct Speech {
    model: Mutex<Option<Model>>,
    device: Mutex<String>,
    next_pass: AtomicU64,
    // Passes numbered at or below this stop as soon as they can (cancel)
    cancelled_through: AtomicU64,
}

impl Default for Speech {
    fn default() -> Self {
        Self {
            model: Mutex::new(None),
            device: Mutex::new(String::new()),
            next_pass: AtomicU64::new(1),
            cancelled_through: AtomicU64::new(0),
        }
    }
}

// whisper.cpp logs every step of every pass; keep warnings and errors
unsafe extern "C" fn on_log(level: sys::ggml_log_level, text: *const c_char, _: *mut c_void) {
    if text.is_null() || level < sys::ggml_log_level_GGML_LOG_LEVEL_WARN {
        return;
    }
    let text = CStr::from_ptr(text).to_string_lossy();
    log::warn!("whisper: {}", text.trim_end());
}

struct AbortCheck<'a> {
    speech: &'a Speech,
    pass: u64,
}

unsafe extern "C" fn should_abort(data: *mut c_void) -> bool {
    let check = &*(data as *const AbortCheck);
    check.pass <= check.speech.cancelled_through.load(Ordering::SeqCst)
}

/// The GPU to use, as whisper.cpp counts them (GPUs and integrated GPUs in
/// ggml's order), and its name. A dedicated GPU is preferred: on a laptop the
/// built-in one is several times slower.
fn pick_gpu() -> Option<(i32, String)> {
    let mut best: Option<(i32, String, bool)> = None;
    let mut index = 0;
    unsafe {
        for i in 0..sys::ggml_backend_dev_count() {
            let device = sys::ggml_backend_dev_get(i);
            let kind = sys::ggml_backend_dev_type(device);
            let dedicated = kind == sys::ggml_backend_dev_type_GGML_BACKEND_DEVICE_TYPE_GPU;
            if !dedicated && kind != sys::ggml_backend_dev_type_GGML_BACKEND_DEVICE_TYPE_IGPU {
                continue;
            }
            if best.as_ref().map_or(true, |(_, _, d)| dedicated && !d) {
                let name = CStr::from_ptr(sys::ggml_backend_dev_description(device)).to_string_lossy().into_owned();
                best = Some((index, name, dedicated));
            }
            index += 1;
        }
    }
    best.map(|(index, name, _)| (index, name))
}

impl Speech {
    /// Load the model if it isn't yet. Returns what it runs on (a GPU's name, or "CPU").
    pub fn load(&self, path: &Path) -> Result<String, String> {
        {
            let mut model = self.model.lock().map_err(|_| "Speech model lock poisoned")?;
            if model.is_some() {
                return Ok(self.device.lock().unwrap().clone());
            }
            let (opened, device) = match pick_gpu() {
                Some((index, name)) => match Self::open(path, Some(index)) {
                    Ok(opened) => (opened, name),
                    Err(e) => {
                        log::warn!("Speech model on the GPU failed ({}), using the CPU", e);
                        (Self::open(path, None)?, "CPU".to_string())
                    }
                },
                None => (Self::open(path, None)?, "CPU".to_string()),
            };
            *model = Some(opened);
            *self.device.lock().unwrap() = device;
        }
        // The GPU compiles its shaders on the first pass (about 10 s the first
        // time; the driver keeps them after that): do it now, not on a question
        self.transcribe(&Pass { audio: &vec![0.0; SAMPLE_RATE], prompt: "", max_tokens: 1, final_pass: false })?;
        Ok(self.device.lock().unwrap().clone())
    }

    fn open(path: &Path, gpu: Option<i32>) -> Result<Model, String> {
        let path_c = CString::new(path.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
        unsafe {
            sys::whisper_log_set(Some(on_log), std::ptr::null_mut());
            let mut params = sys::whisper_context_default_params();
            params.use_gpu = gpu.is_some();
            params.gpu_device = gpu.unwrap_or(0);
            let ctx = sys::whisper_init_from_file_with_params_no_state(path_c.as_ptr(), params);
            if ctx.is_null() {
                return Err(format!("Couldn't load the speech model from {}", path.display()));
            }
            let state = sys::whisper_init_state(ctx);
            if state.is_null() {
                sys::whisper_free(ctx);
                return Err("Couldn't set up the speech model".to_string());
            }
            Ok(Model { ctx, state })
        }
    }

    /// Stop every pass started so far (those still to come run as usual)
    pub fn cancel(&self) {
        let last = self.next_pass.load(Ordering::SeqCst) - 1;
        self.cancelled_through.fetch_max(last, Ordering::SeqCst);
    }

    /// The text spoken in `pass.audio`, or None if cancelled. The model must be loaded.
    pub fn transcribe(&self, pass: &Pass) -> Result<Option<String>, String> {
        let number = self.next_pass.fetch_add(1, Ordering::SeqCst);
        let audio = &pass.audio[..pass.audio.len().min(MAX_SECONDS * SAMPLE_RATE)];
        let prompt = CString::new(pass.prompt.replace('\0', " ")).map_err(|e| e.to_string())?;
        let check = AbortCheck { speech: self, pass: number };

        let model = self.model.lock().map_err(|_| "Speech model lock poisoned")?;
        let model = model.as_ref().ok_or("The speech model isn't loaded")?;
        if should_abort_now(&check) {
            return Ok(None);
        }
        unsafe {
            let mut params = sys::whisper_full_default_params(sys::whisper_sampling_strategy_WHISPER_SAMPLING_GREEDY);
            params.n_threads = std::thread::available_parallelism().map_or(4, |n| n.get().clamp(2, 8) as i32);
            params.language = c"en".as_ptr();
            params.no_context = true; // the prompt carries the context, explicitly
            params.no_timestamps = true;
            params.single_segment = true; // a pass is under 30 s: one segment, no seeking
            params.print_progress = false;
            params.print_realtime = false;
            params.print_timestamps = false;
            params.print_special = false;
            params.suppress_blank = true;
            params.suppress_nst = true; // no "[music]" or "(coughs)"
            params.max_tokens = pass.max_tokens;
            params.temperature = 0.0;
            // A live pass is replaced a moment later anyway; only the final
            // text is worth decoding again when it comes out garbled
            params.temperature_inc = if pass.final_pass { 0.2 } else { 0.0 };
            if !pass.prompt.is_empty() {
                params.initial_prompt = prompt.as_ptr();
            }
            params.abort_callback = Some(should_abort);
            params.abort_callback_user_data = &check as *const AbortCheck as *mut c_void;

            let status = sys::whisper_full_with_state(model.ctx, model.state, params, audio.as_ptr(), audio.len() as i32);
            if should_abort_now(&check) {
                return Ok(None);
            }
            if status != 0 {
                return Err(format!("Speech recognition failed (error {})", status));
            }
            let mut text = String::new();
            for i in 0..sys::whisper_full_n_segments_from_state(model.state) {
                let segment = sys::whisper_full_get_segment_text_from_state(model.state, i);
                if !segment.is_null() {
                    text.push_str(&CStr::from_ptr(segment).to_string_lossy());
                }
            }
            Ok(Some(text.trim().to_string()))
        }
    }
}

fn should_abort_now(check: &AbortCheck) -> bool {
    unsafe { should_abort(check as *const AbortCheck as *mut c_void) }
}
