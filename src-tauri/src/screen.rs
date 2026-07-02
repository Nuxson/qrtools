use base64::{engine::general_purpose::STANDARD as B64, Engine};
use image::DynamicImage;
use screenshots::Screen;
use std::io::Cursor;

pub fn capture_full_screen() -> Result<String, String> {
    let screens = Screen::all().map_err(|e| format!("Screen capture failed: {}", e))?;
    let screen = screens.first().ok_or("No screens found")?;

    let rgba_image = screen
        .capture()
        .map_err(|e| format!("Capture failed: {}", e))?;

    let img = DynamicImage::ImageRgba8(rgba_image);

    let mut png_buf = Cursor::new(Vec::new());
    {
        let mut encoder = png::Encoder::new(&mut png_buf, img.width(), img.height());
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("PNG header: {}", e))?;
        let rgba = img.to_rgba8();
        writer
            .write_image_data(&rgba)
            .map_err(|e| format!("PNG data: {}", e))?;
    }

    Ok(format!(
        "data:image/png;base64,{}",
        B64.encode(&png_buf.into_inner())
    ))
}

pub fn crop_region(
    image_data: &[u8],
    x: u32,
    y: u32,
    w: u32,
    h: u32,
) -> Result<String, String> {
    let img = image::load_from_memory(image_data)
        .map_err(|e| format!("Image decode failed: {}", e))?;

    let rgba = img.to_rgba8();
    let crop_img = image::imageops::crop_imm(&rgba, x, y, w, h);
    let crop_raw = crop_img.to_image();

    let mut png_buf = Cursor::new(Vec::new());
    {
        let mut encoder = png::Encoder::new(&mut png_buf, w, h);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("PNG header: {}", e))?;
        writer
            .write_image_data(&crop_raw)
            .map_err(|e| format!("PNG data: {}", e))?;
    }

    Ok(format!(
        "data:image/png;base64,{}",
        B64.encode(&png_buf.into_inner())
    ))
}
