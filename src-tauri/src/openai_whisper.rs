use log::debug;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use reqwest::multipart::{Form, Part};
use serde::Deserialize;
use std::io::Cursor;

const SAMPLE_RATE: u32 = 16000;

#[derive(Debug, Deserialize)]
struct TranscriptionResponse {
    text: String,
}

#[derive(Debug, Deserialize)]
struct ErrorResponse {
    error: Option<ErrorDetail>,
}

#[derive(Debug, Deserialize)]
struct ErrorDetail {
    message: Option<String>,
}

/// Encode f32 audio samples (assumed 16kHz mono) to WAV format
fn encode_wav(samples: &[f32]) -> Result<Vec<u8>, String> {
    let mut cursor = Cursor::new(Vec::new());

    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer = hound::WavWriter::new(&mut cursor, spec)
        .map_err(|e| format!("Failed to create WAV writer: {}", e))?;

    for &sample in samples {
        // Convert f32 [-1.0, 1.0] to i16
        let sample_i16 = (sample * 32767.0).clamp(-32768.0, 32767.0) as i16;
        writer
            .write_sample(sample_i16)
            .map_err(|e| format!("Failed to write sample: {}", e))?;
    }

    writer
        .finalize()
        .map_err(|e| format!("Failed to finalize WAV: {}", e))?;

    Ok(cursor.into_inner())
}

/// Build headers for OpenAI-compatible API requests
fn build_headers(api_key: &str) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();

    if !api_key.is_empty() {
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", api_key))
                .map_err(|e| format!("Invalid authorization header value: {}", e))?,
        );
    }

    Ok(headers)
}

/// Transcribe audio using an OpenAI-compatible Whisper API
///
/// # Arguments
/// * `audio` - Audio samples as f32 values (assumed 16kHz mono)
/// * `api_key` - API key for authentication
/// * `base_url` - Base URL of the API (e.g., "https://api.openai.com/v1")
/// * `model` - Model name (e.g., "whisper-1")
/// * `language` - Optional language code (e.g., "en", "es"). If None, auto-detect.
///
/// # Returns
/// The transcribed text on success, or an error message on failure.
pub async fn transcribe_with_api(
    audio: Vec<f32>,
    api_key: &str,
    base_url: &str,
    model: &str,
    language: Option<&str>,
) -> Result<String, String> {
    if audio.is_empty() {
        return Err("No audio data provided".to_string());
    }

    if api_key.is_empty() {
        return Err("API key is required for transcription".to_string());
    }

    let base_url = base_url.trim_end_matches('/');
    let url = format!("{}/audio/transcriptions", base_url);

    debug!(
        "Transcribing {} samples with OpenAI Whisper API at {}",
        audio.len(),
        url
    );

    // Encode audio to WAV
    let wav_data = encode_wav(&audio)?;
    debug!("Encoded audio to {} bytes WAV", wav_data.len());

    // Build multipart form
    let audio_part = Part::bytes(wav_data)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| format!("Failed to set MIME type: {}", e))?;

    let mut form = Form::new()
        .part("file", audio_part)
        .text("model", model.to_string());

    // Add language if specified and not "auto"
    if let Some(lang) = language {
        if lang != "auto" && !lang.is_empty() {
            form = form.text("language", lang.to_string());
        }
    }

    // Create client with auth headers
    let headers = build_headers(api_key)?;
    let client = reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    // Send request
    let response = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Failed to read error response".to_string());

        // Try to parse as JSON error
        if let Ok(error_response) = serde_json::from_str::<ErrorResponse>(&error_text) {
            if let Some(error) = error_response.error {
                if let Some(message) = error.message {
                    return Err(format!("API error ({}): {}", status, message));
                }
            }
        }

        return Err(format!(
            "API request failed with status {}: {}",
            status, error_text
        ));
    }

    // Parse successful response
    let transcription: TranscriptionResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse API response: {}", e))?;

    debug!("Transcription result: {}", transcription.text);
    Ok(transcription.text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_wav_empty() {
        let result = encode_wav(&[]);
        assert!(result.is_ok());
        // WAV header is 44 bytes, plus 0 samples
        assert!(result.unwrap().len() >= 44);
    }

    #[test]
    fn test_encode_wav_samples() {
        let samples = vec![0.0, 0.5, -0.5, 1.0, -1.0];
        let result = encode_wav(&samples);
        assert!(result.is_ok());
        let wav = result.unwrap();
        // WAV header (44 bytes) + 5 samples * 2 bytes each = 54 bytes
        assert_eq!(wav.len(), 54);
    }
}
