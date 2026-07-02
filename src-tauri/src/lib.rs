mod qr;
mod screen;

use serde::Serialize;

#[derive(Serialize)]
struct ScanResult {
    success: bool,
    data: Option<String>,
    error: Option<String>,
}

#[tauri::command]
fn generate_qr(plaintext: String, size: u32) -> ScanResult {
    match qr::generate_qr_png(&plaintext, size) {
        Ok(png_bytes) => {
            let b64 = base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                &png_bytes,
            );
            ScanResult {
                success: true,
                data: Some(format!("data:image/png;base64,{}", b64)),
                error: None,
            }
        }
        Err(e) => ScanResult {
            success: false,
            data: None,
            error: Some(e),
        },
    }
}

#[tauri::command]
fn scan_barcodes(image_data: Vec<u8>) -> ScanResult {
    match qr::scan_image_for_barcodes(&image_data) {
        Ok(codes) => {
            let json = serde_json::to_string(&codes).unwrap_or_else(|_| "[]".into());
            ScanResult {
                success: true,
                data: Some(json),
                error: None,
            }
        }
        Err(e) => ScanResult {
            success: false,
            data: None,
            error: Some(e),
        },
    }
}

#[tauri::command]
fn capture_screen() -> ScanResult {
    match screen::capture_full_screen() {
        Ok(b64) => ScanResult {
            success: true,
            data: Some(b64),
            error: None,
        },
        Err(e) => ScanResult {
            success: false,
            data: None,
            error: Some(e),
        },
    }
}

#[tauri::command]
fn crop_image(image_data: Vec<u8>, x: u32, y: u32, w: u32, h: u32) -> ScanResult {
    match screen::crop_region(&image_data, x, y, w, h) {
        Ok(cropped_b64) => ScanResult {
            success: true,
            data: Some(cropped_b64),
            error: None,
        },
        Err(e) => ScanResult {
            success: false,
            data: None,
            error: Some(e),
        },
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            generate_qr,
            scan_barcodes,
            capture_screen,
            crop_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running qrtools");
}
