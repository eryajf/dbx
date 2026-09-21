//! Encryption primitives for values persisted in `connection_secrets`.
//!
//! The database deliberately stores only an envelope (`dbxenc1...`) for new
//! values. Desktop builds keep the local key in the operating system
//! credential store (macOS Keychain, Windows Credential Manager, or Linux
//! Secret Service). `DBX_SECRET_KEY` and `DBX_SECRET_KEY_FILE` are supported
//! for headless deployments. A per-user key file remains as a compatibility
//! fallback for installations created before native credential storage was
//! enabled; the key is always outside the database and never enters a sync file.

use aes_gcm::{
    aead::{rand_core::RngCore, Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::Engine as _;

const PREFIX: &str = "dbxenc1";
const KEYRING_SERVICE: &str = "com.dbx.app.secret-store.v1";
const KEYRING_USER: &str = "local-data-encryption-key";

#[derive(Clone, Copy)]
pub struct SecretCodec {
    key: [u8; 32],
}

impl SecretCodec {
    pub const fn new(key: [u8; 32]) -> Self {
        Self { key }
    }

    /// Build a codec from a high-entropy passphrase using Argon2id.
    pub fn from_passphrase(passphrase: &str) -> Result<Self, String> {
        if passphrase.is_empty() {
            return Err("secret key cannot be empty".to_string());
        }
        let mut key = [0u8; 32];
        let params = Params::new(19 * 1024, 2, 1, Some(32)).map_err(|e| e.to_string())?;
        Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
            .hash_password_into(passphrase.as_bytes(), b"dbx-local-secret-store-v1", &mut key)
            .map_err(|e| e.to_string())?;
        Ok(Self::new(key))
    }

    /// Read an explicitly configured key, then an existing compatibility key
    /// file, then the platform credential store. The file is checked before
    /// creating a new keyring entry so upgrades cannot strand an existing
    /// database behind a newly generated device key.
    pub fn from_env_or_default() -> Result<Self, String> {
        if let Ok(path) = std::env::var("DBX_SECRET_KEY_FILE") {
            let value = std::fs::read_to_string(&path)
                .map_err(|error| format!("failed to read DBX_SECRET_KEY_FILE {path}: {error}"))?;
            return Self::from_key_material(value.trim());
        }
        if let Ok(value) = std::env::var("DBX_SECRET_KEY") {
            return Self::from_key_material(&value);
        }
        if let Some(path) = default_key_path() {
            if let Ok(value) = std::fs::read_to_string(&path) {
                if let Ok(codec) = Self::from_key_material(value.trim()) {
                    tighten_key_file_permissions(&path);
                    return Ok(codec);
                }
            }
        }
        if let Some(codec) = platform_keyring_codec() {
            return Ok(codec);
        }
        if let Some(path) = default_key_path() {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
                let mut key = [0u8; 32];
                OsRng.fill_bytes(&mut key);
                let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(key);
                let write_result = {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::OpenOptionsExt;
                        std::fs::OpenOptions::new()
                            .write(true)
                            .create_new(true)
                            .mode(0o600)
                            .open(&path)
                            .and_then(|mut file| std::io::Write::write_all(&mut file, encoded.as_bytes()))
                    }
                    #[cfg(not(unix))]
                    {
                        std::fs::write(&path, encoded.as_bytes())
                    }
                };
                if write_result.is_ok() {
                    return Ok(Self::new(key));
                }
                if let Ok(value) = std::fs::read_to_string(&path) {
                    if let Ok(codec) = Self::from_key_material(value.trim()) {
                        return Ok(codec);
                    }
                }
            }
        }
        Err("DBX local secret key is unavailable. Configure DBX_SECRET_KEY_FILE or enable a platform credential store."
            .to_string())
    }

    /// Inspect existing key material without creating files or keyring entries.
    /// Headless migration must use an explicitly configured persistent key.
    pub fn from_existing_provider(require_external: bool) -> Result<Self, String> {
        if let Ok(path) = std::env::var("DBX_SECRET_KEY_FILE") {
            let value = std::fs::read_to_string(path).map_err(|_| "SECRET_KEY_FILE_UNREADABLE")?;
            return Self::from_key_material(value.trim());
        }
        if let Ok(value) = std::env::var("DBX_SECRET_KEY") {
            return Self::from_key_material(&value);
        }
        if require_external {
            return Err("PERSISTENT_SECRET_KEY_REQUIRED".to_string());
        }
        if let Some(path) = default_key_path().filter(|path| path.exists()) {
            let value = std::fs::read_to_string(path).map_err(|_| "SECRET_KEY_FILE_UNREADABLE")?;
            return Self::from_key_material(value.trim());
        }
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|_| "KEY_PROVIDER_UNAVAILABLE")?;
        let value = entry.get_password().map_err(|error| match error {
            keyring::Error::NoEntry => "SECRET_KEY_NOT_FOUND",
            _ => "KEY_PROVIDER_UNAVAILABLE",
        })?;
        Self::from_key_material(value.trim())
    }

    /// Provision only after a read-only probe found no usable provider. This
    /// is called by the desktop migration wizard only for plaintext-only
    /// legacy data; headless callers never use it. If the platform keyring is
    /// unavailable, the documented per-user key-file fallback keeps Linux
    /// desktop upgrades recoverable without putting a key in SQLite.
    pub fn provision_for_migration() -> Result<Self, String> {
        match Self::from_existing_provider(false) {
            Ok(codec) => return Ok(codec),
            Err(error) if matches!(error.as_str(), "SECRET_KEY_NOT_FOUND" | "KEY_PROVIDER_UNAVAILABLE") => {}
            Err(_) => return Err("KEY_PROVIDER_UNAVAILABLE".to_string()),
        }
        Self::from_env_or_default().map_err(|_| "KEY_PROVIDER_UNAVAILABLE".to_string())
    }

    fn from_key_material(value: &str) -> Result<Self, String> {
        if let Ok(bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(value) {
            if bytes.len() == 32 {
                return bytes.try_into().map(Self::new).map_err(|_| "invalid key".into());
            }
        }
        if value.is_ascii() && value.len() == 64 {
            let mut out = [0u8; 32];
            for (i, slot) in out.iter_mut().enumerate() {
                *slot = u8::from_str_radix(&value[i * 2..i * 2 + 2], 16).map_err(|_| "invalid hex key")?;
            }
            return Ok(Self::new(out));
        }
        Self::from_passphrase(value)
    }

    pub fn encrypt(&self, namespace: &str, key: &str, plaintext: &str) -> Result<String, String> {
        let mut nonce = [0u8; 12];
        OsRng.fill_bytes(&mut nonce);
        let cipher = Aes256Gcm::new_from_slice(&self.key).map_err(|e| e.to_string())?;
        let ciphertext = cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                aes_gcm::aead::Payload { msg: plaintext.as_bytes(), aad: aad(namespace, key).as_bytes() },
            )
            .map_err(|_| "secret encryption failed".to_string())?;
        let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD;
        Ok(format!("{PREFIX}.{}.{}", b64.encode(nonce), b64.encode(ciphertext)))
    }

    pub fn decrypt(&self, namespace: &str, key: &str, envelope: &str) -> Result<String, String> {
        let mut parts = envelope.split('.');
        if parts.next() != Some(PREFIX) {
            return Err("unsupported secret envelope".to_string());
        }
        let nonce = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(parts.next().ok_or("invalid secret envelope")?)
            .map_err(|_| "invalid secret nonce".to_string())?;
        let ciphertext = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(parts.next().ok_or("invalid secret envelope")?)
            .map_err(|_| "invalid secret ciphertext".to_string())?;
        if parts.next().is_some() || nonce.len() != 12 {
            return Err("invalid secret envelope".to_string());
        }
        let cipher = Aes256Gcm::new_from_slice(&self.key).map_err(|e| e.to_string())?;
        let plaintext = cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                aes_gcm::aead::Payload { msg: &ciphertext, aad: aad(namespace, key).as_bytes() },
            )
            .map_err(|_| "secret decryption failed".to_string())?;
        String::from_utf8(plaintext).map_err(|_| "secret is not valid UTF-8".to_string())
    }
}

fn platform_keyring_codec() -> Option<SecretCodec> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()?;
    match entry.get_password() {
        Ok(value) => return SecretCodec::from_key_material(value.trim()).ok(),
        Err(keyring::Error::NoEntry) => {}
        Err(_) => return None,
    }
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(key);
    entry.set_password(&encoded).ok()?;
    Some(SecretCodec::new(key))
}

fn tighten_key_file_permissions(path: &std::path::Path) {
    #[cfg(unix)]
    {
        let _ = std::fs::set_permissions(path, std::os::unix::fs::PermissionsExt::from_mode(0o600));
    }
}

fn default_key_path() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "macos")]
    if let Ok(home) = std::env::var("HOME") {
        return Some(std::path::PathBuf::from(home).join("Library/Application Support/dbx/secret.key"));
    }
    if let Ok(config) = std::env::var("XDG_CONFIG_HOME") {
        return Some(std::path::PathBuf::from(config).join("dbx/secret.key"));
    }
    std::env::var_os("APPDATA").map(std::path::PathBuf::from).map(|path| path.join("dbx/secret.key")).or_else(|| {
        std::env::var_os("HOME").map(std::path::PathBuf::from).map(|path| path.join(".config/dbx/secret.key"))
    })
}

fn aad(namespace: &str, key: &str) -> String {
    format!("dbx-secret-v1\0{namespace}\0{key}")
}

#[cfg(test)]
mod tests {
    use super::SecretCodec;

    #[test]
    fn roundtrip_binds_namespace_and_key() {
        let codec = SecretCodec::new([7u8; 32]);
        let envelope = codec.encrypt("connection-1", "password", "s3cret").unwrap();
        assert!(envelope.starts_with("dbxenc1."));
        assert_eq!(codec.decrypt("connection-1", "password", &envelope).unwrap(), "s3cret");
        assert!(codec.decrypt("connection-2", "password", &envelope).is_err());
        assert!(codec.decrypt("connection-1", "token", &envelope).is_err());
    }

    #[test]
    fn unicode_key_material_never_slices_inside_a_character() {
        // 64 bytes, with the second byte inside a three-byte character.
        let material = format!("{}a", "密".repeat(21));
        assert_eq!(material.len(), 64);
        let codec = SecretCodec::from_key_material(&material).unwrap();
        let encrypted = codec.encrypt("n", "k", "value").unwrap();
        assert_eq!(codec.decrypt("n", "k", &encrypted).unwrap(), "value");
    }

    #[test]
    fn tampering_is_rejected() {
        let codec = SecretCodec::new([3u8; 32]);
        let mut envelope = codec.encrypt("n", "k", "value").unwrap();
        envelope.push('x');
        assert!(codec.decrypt("n", "k", &envelope).is_err());
    }
}
