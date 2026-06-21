use std::collections::VecDeque;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter};
use std::path::{Path, PathBuf};

use mp4::{AvcConfig, MediaConfig, MediaType, Mp4Config, Mp4Reader, Mp4Writer, TrackConfig};

#[derive(Debug, Clone)]
pub struct Segment {
    pub path: PathBuf,
    pub duration_seconds: f64,
    pub bytes: u64,
}

#[derive(Debug)]
pub struct RingBuffer {
    directory: PathBuf,
    max_seconds: f64,
    sequence: u64,
    segments: VecDeque<Segment>,
}

impl RingBuffer {
    pub fn new(directory: PathBuf, max_seconds: u64) -> Result<Self, String> {
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
            let path = entry.map_err(|error| error.to_string())?.path();
            if path.extension().is_some_and(|extension| extension == "mp4") {
                let _ = fs::remove_file(path);
            }
        }
        Ok(Self {
            directory,
            max_seconds: max_seconds as f64,
            sequence: 0,
            segments: VecDeque::new(),
        })
    }

    pub fn next_path(&mut self) -> PathBuf {
        self.sequence += 1;
        self.directory
            .join(format!("segment-{:08}.mp4", self.sequence))
    }

    pub fn complete(&mut self, path: PathBuf, duration_seconds: f64) {
        let bytes = fs::metadata(&path).map_or(0, |metadata| metadata.len());
        self.segments.push_back(Segment {
            path,
            duration_seconds,
            bytes,
        });
        while self.buffered_seconds() > self.max_seconds {
            let Some(front) = self.segments.front() else {
                break;
            };
            if self.buffered_seconds() - front.duration_seconds < self.max_seconds {
                break;
            }
            if let Some(expired) = self.segments.pop_front() {
                let _ = fs::remove_file(expired.path);
            }
        }
    }

    pub fn snapshot(&self, requested_seconds: u64) -> Vec<Segment> {
        let mut selected = Vec::new();
        let mut duration = 0.0;
        for segment in self.segments.iter().rev() {
            selected.push(segment.clone());
            duration += segment.duration_seconds;
            if duration >= requested_seconds as f64 {
                break;
            }
        }
        selected.reverse();
        selected
    }

    pub fn buffered_seconds(&self) -> f64 {
        self.segments
            .iter()
            .map(|segment| segment.duration_seconds)
            .sum()
    }

    pub fn total_bytes(&self) -> u64 {
        self.segments.iter().map(|segment| segment.bytes).sum()
    }

    pub fn segment_count(&self) -> usize {
        self.segments.len()
    }
}

pub fn remux_segments(segments: &[Segment], output: &Path) -> Result<f64, String> {
    let first = segments
        .first()
        .ok_or_else(|| "Replay buffer does not contain a completed segment yet".to_string())?;
    let first_file = File::open(&first.path).map_err(|error| error.to_string())?;
    let first_size = first_file
        .metadata()
        .map_err(|error| error.to_string())?
        .len();
    let first_reader = Mp4Reader::read_header(BufReader::new(first_file), first_size)
        .map_err(|error| error.to_string())?;
    let first_track = first_reader
        .tracks()
        .values()
        .find(|track| track.media_type().ok() == Some(MediaType::H264))
        .ok_or_else(|| "Segment does not contain an H.264 video track".to_string())?;

    let avc = AvcConfig {
        width: first_track.width(),
        height: first_track.height(),
        seq_param_set: first_track
            .sequence_parameter_set()
            .map_err(|error| error.to_string())?
            .to_vec(),
        pic_param_set: first_track
            .picture_parameter_set()
            .map_err(|error| error.to_string())?
            .to_vec(),
    };
    let track_config = TrackConfig {
        track_type: mp4::TrackType::Video,
        timescale: first_track.timescale(),
        language: first_track.language().to_string(),
        media_conf: MediaConfig::AvcConfig(avc.clone()),
    };
    let config = Mp4Config {
        major_brand: "isom"
            .parse()
            .map_err(|error: mp4::Error| error.to_string())?,
        minor_version: 512,
        compatible_brands: ["isom", "iso2", "avc1", "mp41"]
            .into_iter()
            .map(|brand| brand.parse().map_err(|error: mp4::Error| error.to_string()))
            .collect::<Result<Vec<_>, _>>()?,
        timescale: 1_000,
    };

    let output_file = File::create(output).map_err(|error| error.to_string())?;
    let mut writer = Mp4Writer::write_start(BufWriter::new(output_file), &config)
        .map_err(|error| error.to_string())?;
    writer
        .add_track(&track_config)
        .map_err(|error| error.to_string())?;
    let mut timeline = 0_u64;

    for segment in segments {
        let file = File::open(&segment.path).map_err(|error| error.to_string())?;
        let size = file.metadata().map_err(|error| error.to_string())?.len();
        let mut reader = Mp4Reader::read_header(BufReader::new(file), size)
            .map_err(|error| error.to_string())?;
        let track = reader
            .tracks()
            .values()
            .find(|track| track.media_type().ok() == Some(MediaType::H264))
            .ok_or_else(|| "Segment does not contain an H.264 video track".to_string())?;
        let track_id = track.track_id();
        let sample_count = track.sample_count();
        let segment_avc = (
            track
                .sequence_parameter_set()
                .map_err(|error| error.to_string())?
                .to_vec(),
            track
                .picture_parameter_set()
                .map_err(|error| error.to_string())?
                .to_vec(),
        );
        if segment_avc.0 != avc.seq_param_set || segment_avc.1 != avc.pic_param_set {
            return Err("Encoder parameters changed inside the replay buffer".into());
        }

        let mut segment_duration = 0_u64;
        for sample_id in 1..=sample_count {
            if let Some(mut sample) = reader
                .read_sample(track_id, sample_id)
                .map_err(|error| error.to_string())?
            {
                sample.start_time = timeline + segment_duration;
                segment_duration += u64::from(sample.duration);
                writer
                    .write_sample(1, &sample)
                    .map_err(|error| error.to_string())?;
            }
        }
        timeline += segment_duration;
    }

    writer.write_end().map_err(|error| error.to_string())?;
    Ok(segments
        .iter()
        .map(|segment| segment.duration_seconds)
        .sum())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_returns_newest_segments_in_playback_order() {
        let mut ring = RingBuffer {
            directory: PathBuf::new(),
            max_seconds: 60.0,
            sequence: 0,
            segments: VecDeque::new(),
        };
        for index in 1..=4 {
            ring.segments.push_back(Segment {
                path: PathBuf::from(format!("{index}.mp4")),
                duration_seconds: 5.0,
                bytes: 10,
            });
        }
        let selected = ring.snapshot(12);
        assert_eq!(
            selected
                .iter()
                .map(|segment| segment.path.clone())
                .collect::<Vec<_>>(),
            vec![
                PathBuf::from("2.mp4"),
                PathBuf::from("3.mp4"),
                PathBuf::from("4.mp4"),
            ]
        );
    }
}
