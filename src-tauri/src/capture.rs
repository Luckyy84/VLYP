use std::error::Error;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use windows_capture::capture::{CaptureControl, Context, GraphicsCaptureApiHandler};
use windows_capture::encoder::{
    AudioSettingsBuilder, ContainerSettingsBuilder, VideoEncoder, VideoSettingsBuilder,
    VideoSettingsSubType,
};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::InternalCaptureControl;
use windows_capture::monitor::Monitor;
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    GraphicsCaptureItemType, MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window;

use crate::replay::RingBuffer;
use crate::types::{
    CaptureSource, CaptureSourceKind, CaptureTelemetry, RecorderState, ReplayConfig,
};

type CaptureError = Box<dyn Error + Send + Sync>;
type ActiveCapture = CaptureControl<CaptureWorker, CaptureError>;

#[derive(Clone)]
struct CaptureFlags {
    width: u32,
    height: u32,
    frame_rate: u32,
    bitrate: u32,
    segment_seconds: u64,
    ring: Arc<Mutex<RingBuffer>>,
    telemetry: Arc<Mutex<CaptureTelemetry>>,
}

pub struct CaptureRuntime {
    control: Option<ActiveCapture>,
    pub ring: Arc<Mutex<RingBuffer>>,
    pub telemetry: Arc<Mutex<CaptureTelemetry>>,
}

impl CaptureRuntime {
    pub fn new(buffer_directory: PathBuf) -> Result<Self, String> {
        Ok(Self {
            control: None,
            ring: Arc::new(Mutex::new(RingBuffer::new(buffer_directory, 60)?)),
            telemetry: Arc::new(Mutex::new(CaptureTelemetry::default())),
        })
    }

    pub fn start(&mut self, config: ReplayConfig, buffer_directory: PathBuf) -> Result<(), String> {
        config.validate()?;
        if self.control.is_some() {
            return Err("Replay capture is already running".into());
        }

        self.ring = Arc::new(Mutex::new(RingBuffer::new(
            buffer_directory,
            config.buffer_seconds,
        )?));
        self.telemetry.lock().state = RecorderState::Starting;
        let selected = resolve_source(&config.source_id)?;
        let (source_name, width, height, native_rate) = selected.details()?;
        let frame_rate = config.frame_rate.unwrap_or(native_rate).max(1);
        let flags = CaptureFlags {
            width,
            height,
            frame_rate,
            bitrate: config.bitrate,
            segment_seconds: config.segment_seconds,
            ring: self.ring.clone(),
            telemetry: self.telemetry.clone(),
        };
        let cursor = if config.capture_cursor {
            CursorCaptureSettings::WithCursor
        } else {
            CursorCaptureSettings::WithoutCursor
        };

        let control = match selected {
            SelectedSource::Monitor(monitor) => start_item(monitor, flags, cursor),
            SelectedSource::Window(window) => start_item(window, flags, cursor),
        }
        .map_err(|error| error.to_string())?;

        *self.telemetry.lock() = CaptureTelemetry {
            state: RecorderState::Recording,
            source_name: Some(source_name),
            encoder_name: Some("Media Foundation H.264 (hardware preferred)".into()),
            width,
            height,
            bitrate: config.bitrate,
            ..CaptureTelemetry::default()
        };
        self.control = Some(control);
        Ok(())
    }

    pub fn stop(&mut self) -> Result<(), String> {
        let Some(control) = self.control.take() else {
            return Ok(());
        };
        self.telemetry.lock().state = RecorderState::Stopping;
        control.stop().map_err(|error| error.to_string())?;
        self.telemetry.lock().state = RecorderState::Idle;
        Ok(())
    }

    pub fn refresh_buffer_stats(&self) {
        let ring = self.ring.lock();
        let mut telemetry = self.telemetry.lock();
        telemetry.buffered_seconds = ring.buffered_seconds();
        telemetry.segment_count = ring.segment_count();
        telemetry.buffer_bytes = ring.total_bytes();
    }
}

fn start_item<T>(
    item: T,
    flags: CaptureFlags,
    cursor: CursorCaptureSettings,
) -> Result<ActiveCapture, windows_capture::capture::GraphicsCaptureApiError<CaptureError>>
where
    T: TryInto<GraphicsCaptureItemType> + Send + 'static,
{
    let interval = Duration::from_nanos(1_000_000_000 / u64::from(flags.frame_rate));
    let settings = Settings::new(
        item,
        cursor,
        DrawBorderSettings::WithoutBorder,
        SecondaryWindowSettings::Include,
        MinimumUpdateIntervalSettings::Custom(interval),
        DirtyRegionSettings::Default,
        ColorFormat::Bgra8,
        flags,
    );
    CaptureWorker::start_free_threaded(settings)
}

struct CaptureWorker {
    encoder: Option<VideoEncoder>,
    segment_path: PathBuf,
    segment_started: Instant,
    frames_since_sample: u64,
    sample_started: Instant,
    flags: CaptureFlags,
}

impl CaptureWorker {
    fn create_encoder(flags: &CaptureFlags, path: &PathBuf) -> Result<VideoEncoder, CaptureError> {
        let video = VideoSettingsBuilder::new(flags.width, flags.height)
            .sub_type(VideoSettingsSubType::H264)
            .bitrate(flags.bitrate)
            .frame_rate(flags.frame_rate);
        Ok(VideoEncoder::new(
            video,
            AudioSettingsBuilder::default().disabled(true),
            ContainerSettingsBuilder::default(),
            path,
        )?)
    }

    fn finish_segment(&mut self) -> Result<(), CaptureError> {
        if let Some(encoder) = self.encoder.take() {
            encoder.finish()?;
            let duration = self.segment_started.elapsed().as_secs_f64();
            self.flags
                .ring
                .lock()
                .complete(self.segment_path.clone(), duration);
        }
        Ok(())
    }

    fn begin_segment(&mut self) -> Result<(), CaptureError> {
        let path = self.flags.ring.lock().next_path();
        self.encoder = Some(Self::create_encoder(&self.flags, &path)?);
        self.segment_path = path;
        self.segment_started = Instant::now();
        Ok(())
    }
}

impl GraphicsCaptureApiHandler for CaptureWorker {
    type Flags = CaptureFlags;
    type Error = CaptureError;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        let path = ctx.flags.ring.lock().next_path();
        let encoder = Self::create_encoder(&ctx.flags, &path)?;
        Ok(Self {
            encoder: Some(encoder),
            segment_path: path,
            segment_started: Instant::now(),
            frames_since_sample: 0,
            sample_started: Instant::now(),
            flags: ctx.flags,
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        _capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        if self.segment_started.elapsed().as_secs() >= self.flags.segment_seconds {
            self.finish_segment()?;
            self.begin_segment()?;
        }
        if let Some(encoder) = self.encoder.as_mut() {
            encoder.send_frame(frame)?;
        }

        self.frames_since_sample += 1;
        if self.sample_started.elapsed() >= Duration::from_secs(1) {
            let elapsed = self.sample_started.elapsed().as_secs_f64();
            let ring = self.flags.ring.lock();
            let mut telemetry = self.flags.telemetry.lock();
            telemetry.state = RecorderState::Recording;
            telemetry.frames_encoded += self.frames_since_sample;
            telemetry.frame_rate = self.frames_since_sample as f64 / elapsed;
            telemetry.buffered_seconds = ring.buffered_seconds();
            telemetry.segment_count = ring.segment_count();
            telemetry.buffer_bytes = ring.total_bytes();
            self.frames_since_sample = 0;
            self.sample_started = Instant::now();
        }
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        self.finish_segment()
    }
}

impl Drop for CaptureWorker {
    fn drop(&mut self) {
        let _ = self.finish_segment();
    }
}

enum SelectedSource {
    Monitor(Monitor),
    Window(Window),
}

impl SelectedSource {
    fn details(&self) -> Result<(String, u32, u32, u32), String> {
        match self {
            Self::Monitor(monitor) => Ok((
                monitor.name().unwrap_or_else(|_| "Monitor".into()),
                monitor.width().map_err(|error| error.to_string())?,
                monitor.height().map_err(|error| error.to_string())?,
                monitor.refresh_rate().unwrap_or(60),
            )),
            Self::Window(window) => Ok((
                window.title().unwrap_or_else(|_| "Window".into()),
                window.width().map_err(|error| error.to_string())?.max(1) as u32,
                window.height().map_err(|error| error.to_string())?.max(1) as u32,
                window
                    .monitor()
                    .and_then(|monitor| monitor.refresh_rate().ok())
                    .unwrap_or(60),
            )),
        }
    }
}

fn resolve_source(id: &str) -> Result<SelectedSource, String> {
    let (kind, raw_index) = id
        .split_once(':')
        .ok_or_else(|| "Invalid capture source id".to_string())?;
    let index = raw_index
        .parse::<usize>()
        .map_err(|_| "Invalid capture source index".to_string())?;
    match kind {
        "monitor" => Monitor::from_index(index)
            .map(SelectedSource::Monitor)
            .map_err(|error| error.to_string()),
        "window" => Window::enumerate()
            .map_err(|error| error.to_string())?
            .into_iter()
            .nth(index)
            .map(SelectedSource::Window)
            .ok_or_else(|| "The selected window is no longer available".into()),
        _ => Err("Unknown capture source kind".into()),
    }
}

pub fn enumerate_sources() -> Result<Vec<CaptureSource>, String> {
    let mut sources = Vec::new();
    for monitor in Monitor::enumerate().map_err(|error| error.to_string())? {
        let index = monitor.index().map_err(|error| error.to_string())?;
        sources.push(CaptureSource {
            id: format!("monitor:{index}"),
            kind: CaptureSourceKind::Monitor,
            name: monitor
                .name()
                .unwrap_or_else(|_| format!("Monitor {index}")),
            process_name: None,
            width: monitor.width().unwrap_or(0),
            height: monitor.height().unwrap_or(0),
            refresh_rate: monitor.refresh_rate().ok(),
        });
    }
    for (index, window) in Window::enumerate()
        .map_err(|error| error.to_string())?
        .into_iter()
        .enumerate()
    {
        sources.push(CaptureSource {
            id: format!("window:{index}"),
            kind: CaptureSourceKind::Window,
            name: window.title().unwrap_or_else(|_| "Untitled window".into()),
            process_name: window.process_name().ok(),
            width: window.width().unwrap_or(0).max(0) as u32,
            height: window.height().unwrap_or(0).max(0) as u32,
            refresh_rate: window
                .monitor()
                .and_then(|monitor| monitor.refresh_rate().ok()),
        });
    }
    Ok(sources)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enumerates_at_least_one_monitor_on_windows() {
        let sources = enumerate_sources().expect("capture sources should enumerate");
        assert!(
            sources
                .iter()
                .any(|source| matches!(source.kind, CaptureSourceKind::Monitor))
        );
    }
}
