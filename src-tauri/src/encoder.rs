use crate::types::EncoderCapability;

pub fn enumerate_encoders() -> Vec<EncoderCapability> {
    vec![
        EncoderCapability {
            id: "media-foundation-h264-hardware".into(),
            name: "Media Foundation H.264".into(),
            codec: "H.264/AVC".into(),
            hardware_preferred: true,
            available: true,
            note: "Windows selects the compatible NVIDIA, AMD, or Intel hardware MFT for the active adapter.".into(),
        },
        EncoderCapability {
            id: "media-foundation-h264-software".into(),
            name: "Media Foundation H.264 software fallback".into(),
            codec: "H.264/AVC".into(),
            hardware_preferred: false,
            available: true,
            note: "Used automatically when Windows cannot prepare a hardware-accelerated transcode.".into(),
        },
    ]
}
