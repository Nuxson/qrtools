mod crypto;
mod qr;

use crypto::CryptoEngine;
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

struct AppState {
    crypto: Mutex<Option<CryptoEngine>>,
    key: Mutex<Option<String>>,
}

#[derive(Serialize)]
struct CryptoResult {
    success: bool,
    data: Option<String>,
    error: Option<String>,
}

#[tauri::command]
fn generate_key() -> String {
    crypto::generate_key()
}

#[tauri::command]
fn set_key(state: State<'_, AppState>, key: String) -> CryptoResult {
    match CryptoEngine::new(&key) {
        Ok(engine) => {
            *state.crypto.lock().unwrap() = Some(engine);
            *state.key.lock().unwrap() = Some(key.clone());
            CryptoResult {
                success: true,
                data: Some(key),
                error: None,
            }
        }
        Err(e) => CryptoResult {
            success: false,
            data: None,
            error: Some(e),
        },
    }
}

#[tauri::command]
fn encrypt_data(state: State<'_, AppState>, plaintext: String) -> CryptoResult {
    let guard = state.crypto.lock().unwrap();
    match guard.as_ref() {
        Some(engine) => match engine.encrypt(&plaintext) {
            Ok(enc) => CryptoResult {
                success: true,
                data: Some(enc),
                error: None,
            },
            Err(e) => CryptoResult {
                success: false,
                data: None,
                error: Some(e),
            },
        },
        None => CryptoResult {
            success: false,
            data: None,
            error: Some("Key not set. Generate or load a key first.".into()),
        },
    }
}

#[tauri::command]
fn decrypt_data(state: State<'_, AppState>, ciphertext: String) -> CryptoResult {
    let guard = state.crypto.lock().unwrap();
    match guard.as_ref() {
        Some(engine) => match engine.decrypt(&ciphertext) {
            Ok(dec) => CryptoResult {
                success: true,
                data: Some(dec),
                error: None,
            },
            Err(e) => CryptoResult {
                success: false,
                data: None,
                error: Some(e),
            },
        },
        None => CryptoResult {
            success: false,
            data: None,
            error: Some("Key not set. Generate or load a key first.".into()),
        },
    }
}

#[tauri::command]
fn generate_encrypted_qr(
    state: State<'_, AppState>,
    plaintext: String,
    size: u32,
) -> CryptoResult {
    let guard = state.crypto.lock().unwrap();
    match guard.as_ref() {
        Some(engine) => {
            let encrypted = match engine.encrypt(&plaintext) {
                Ok(enc) => enc,
                Err(e) => {
                    return CryptoResult {
                        success: false,
                        data: None,
                        error: Some(e),
                    }
                }
            };

            match qr::generate_qr_png(&encrypted, size) {
                Ok(png_bytes) => {
                    let b64 = base64::Engine::encode(
                        &base64::engine::general_purpose::STANDARD,
                        &png_bytes,
                    );
                    CryptoResult {
                        success: true,
                        data: Some(format!("data:image/png;base64,{}", b64)),
                        error: None,
                    }
                }
                Err(e) => CryptoResult {
                    success: false,
                    data: None,
                    error: Some(e),
                },
            }
        }
        None => CryptoResult {
            success: false,
            data: None,
            error: Some("Key not set. Generate or load a key first.".into()),
        },
    }
}

#[tauri::command]
fn scan_barcodes(image_data: Vec<u8>) -> CryptoResult {
    match qr::scan_image_for_barcodes(&image_data) {
        Ok(codes) => {
            let json = serde_json::to_string(&codes).unwrap_or_else(|_| "[]".into());
            CryptoResult {
                success: true,
                data: Some(json),
                error: None,
            }
        }
        Err(e) => CryptoResult {
            success: false,
            data: None,
            error: Some(e),
        },
    }
}

#[tauri::command]
fn get_current_key(state: State<'_, AppState>) -> Option<String> {
    state.key.lock().unwrap().clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            crypto: Mutex::new(None),
            key: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            generate_key,
            set_key,
            encrypt_data,
            decrypt_data,
            generate_encrypted_qr,
            scan_barcodes,
            get_current_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running qrtools");
}
