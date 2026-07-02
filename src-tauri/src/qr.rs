use bardecoder::default_decoder;
use qrcode::QrCode;
use std::io::Cursor;

pub fn generate_qr_png(data: &str, size: u32) -> Result<Vec<u8>, String> {
    let code = QrCode::new(data.as_bytes()).map_err(|e| format!("QR encode failed: {}", e))?;

    let width = code.width() as u32;
    let quiet_zone: u32 = 4;
    let total_modules = width + quiet_zone * 2;
    let cell_size = size / total_modules;
    let actual_size = cell_size * total_modules;

    let colors = code.to_colors();
    let mut pixels: Vec<u8> = vec![255u8; (actual_size * actual_size * 3) as usize];

    for (idx, color) in colors.iter().enumerate() {
        let x = idx as u32 % width;
        let y = idx as u32 / width;
        if matches!(color, qrcode::Color::Dark) {
            let px = (x + quiet_zone) * cell_size;
            let py = (y + quiet_zone) * cell_size;
            for dy in 0..cell_size {
                for dx in 0..cell_size {
                    let px2 = px + dx;
                    let py2 = py + dy;
                    if px2 < actual_size && py2 < actual_size {
                        let pi = (py2 * actual_size + px2) as usize * 3;
                        pixels[pi] = 26;
                        pixels[pi + 1] = 27;
                        pixels[pi + 2] = 38;
                    }
                }
            }
        }
    }

    write_png(actual_size, actual_size, &pixels)
}

fn write_png(width: u32, height: u32, rgb: &[u8]) -> Result<Vec<u8>, String> {
    use png::Encoder;
    let mut buf = Cursor::new(Vec::new());
    {
        let mut encoder = Encoder::new(&mut buf, width, height);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| format!("PNG header: {}", e))?;
        writer
            .write_image_data(rgb)
            .map_err(|e| format!("PNG data: {}", e))?;
    }
    Ok(buf.into_inner())
}

pub fn scan_image_for_barcodes(image_data: &[u8]) -> Result<Vec<String>, String> {
    let img = image::load_from_memory(image_data)
        .map_err(|e| format!("Image decode failed: {}", e))?;
    let rgba = img.to_rgba8();

    let decoder = default_decoder();
    let results = decoder.decode(&rgba);

    let mut codes = Vec::new();
    for result in results {
        if let Ok(code) = result {
            if !code.is_empty() {
                codes.push(code);
            }
        }
    }

    Ok(codes)
}
