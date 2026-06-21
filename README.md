# VLYP

![VLYP icon](assets/vlyp-icon.png)

VLYP is a lightweight, local Windows recording app for instantly capturing,
trimming, and compressing gameplay or desktop moments without accounts or
cloud storage.

> [!NOTE]
> VLYP is currently a capture-engine prototype. It is not ready for daily use.

## Current Prototype

- Tauri 2 and React diagnostics interface
- Windows Graphics Capture with Direct3D 11 surfaces
- Media Foundation H.264 encoding with hardware acceleration preferred
- Disk-backed rolling MP4 segments from 30 seconds to 5 minutes
- Replay saves through pure-Rust MP4 remuxing without video re-encoding
- SQLite-backed local clip library
- `Ctrl+Shift+F10` global replay hotkey

## Planned Features

- Rolling replay buffer and manual recording
- Hardware encoding through NVIDIA, AMD, or Intel media engines
- Automatic software-encoding fallback
- Separate game, application, desktop, and microphone audio tracks
- Local clip library and non-destructive trimming
- Size-targeted exports for services such as Discord
- No required account or cloud service

## Icon Assets

The editable icon source and generated application formats live in `assets/`:

- `vlyp-icon.svg` - editable vector source
- `vlyp-icon.png` - transparent 1024x1024 PNG
- `vlyp-icon.ico` - Windows icon with 16px through 256px frames

Rebuild the generated assets with Python 3 and Pillow:

```powershell
python -m pip install -r requirements.txt
python scripts/build_icon.py
```

## Development

VLYP requires Windows 11, Rust 1.96, the MSVC C++ build tools, Windows SDK,
Node.js 24, and pnpm 11.

```powershell
corepack pnpm install
corepack pnpm tauri dev
```

Run all local checks with:

```powershell
corepack pnpm check
corepack pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## License

VLYP is available under the [MIT License](LICENSE).
