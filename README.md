# VLYP

![VLYP icon](assets/vlyp-icon.png)

VLYP is a lightweight, local Windows recording app for instantly capturing,
trimming, and compressing gameplay or desktop moments without accounts or
cloud storage.

> [!NOTE]
> VLYP is currently in early development. The repository presently contains
> the initial application icon and its reproducible build tooling.

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

## License

VLYP is available under the [MIT License](LICENSE).
