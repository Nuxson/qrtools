use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;

pub struct CryptoEngine {
    cipher: Aes256Gcm,
}

impl CryptoEngine {
    pub fn new(key_b64: &str) -> Result<Self, String> {
        let key_bytes = B64
            .decode(key_b64)
            .map_err(|e| format!("Invalid key base64: {}", e))?;
        if key_bytes.len() != 32 {
            return Err("Key must be 32 bytes (256 bits)".into());
        }
        let cipher =
            Aes256Gcm::new_from_slice(&key_bytes).map_err(|e| format!("Cipher init failed: {}", e))?;
        Ok(Self { cipher })
    }

    pub fn encrypt(&self, plaintext: &str) -> Result<String, String> {
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = self
            .cipher
            .encrypt(nonce, plaintext.as_bytes())
            .map_err(|e| format!("Encryption failed: {}", e))?;

        let mut result = nonce_bytes.to_vec();
        result.extend_from_slice(&ciphertext);

        Ok(B64.encode(&result))
    }

    pub fn decrypt(&self, encoded: &str) -> Result<String, String> {
        let data = B64
            .decode(encoded)
            .map_err(|e| format!("Invalid base64: {}", e))?;
        if data.len() < 12 {
            return Err("Ciphertext too short".into());
        }

        let (nonce_bytes, ciphertext) = data.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);

        let plaintext = self
            .cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| format!("Decryption failed (wrong key or corrupted data): {}", e))?;

        String::from_utf8(plaintext).map_err(|e| format!("Invalid UTF-8: {}", e))
    }
}

pub fn generate_key() -> String {
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    B64.encode(&key)
}
