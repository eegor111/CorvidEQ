//! The computer's audio outputs and inputs, and facts about each one that
//! decide what the analyzer actually hears. Everything here is read from
//! Windows, never guessed:
//!
//! - **Volume control**: does the device itself turn the sound down
//!   ("hardware" volume), or does Windows scale the samples before handing
//!   them over ("software")? Loopback capture taps the stream on its way to
//!   the device, so the Windows volume reaches the capture on some outputs
//!   and not on others. `OutputVolume` undoes that, so the analyzer reads the
//!   same on all of them.
//! - **Equalizer APO**: is it loaded on this device, and in which effect slot?
//!   Read from the same registry entries Windows uses to load audio effects.
//! - **Format**: the sample rate, channels and sample type Windows mixes in
//!   (what the capture delivers).

use cpal::traits::{DeviceTrait, HostTrait};
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    IMMDevice, ENDPOINT_HARDWARE_SUPPORT_MUTE, ENDPOINT_HARDWARE_SUPPORT_VOLUME,
};
use windows::Win32::System::Com::{CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
use windows::Win32::System::Registry::{
    RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_MULTI_SZ, RRF_RT_REG_SZ, RRF_SUBKEY_WOW6464KEY,
};

/// Equalizer APO's two effect classes (as registered in HKCR\CLSID).
const EAPO_PRE_MIX: &str = "{EACD2258-FCAC-4FF4-B36D-419E924A6D79}";
const EAPO_POST_MIX: &str = "{EC1CC9CE-FAED-4822-828A-82A81A6F018F}";

/// Where Windows keeps each device's effect list (`PKEY_FX_*` values). The
/// number after the comma says which slot: stream effects run on each app's
/// sound before mixing, mode/endpoint effects on the mix.
const FX_KEY: &str = "{d04e05a6-594b-4fb6-a80d-01af5eed7d1d}";
const FX_SLOTS: [(u32, &str); 8] = [
    (1, "pre-mix (LFX)"),
    (2, "post-mix (GFX)"),
    (5, "stream (SFX)"),
    (6, "mode (MFX)"),
    (7, "endpoint (EFX)"),
    (13, "stream (SFX)"),
    (14, "mode (MFX)"),
    (15, "endpoint (EFX)"),
];

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    /// cpal's id; pass it back to `start_spectrum` to capture this device.
    id: String,
    /// Windows' endpoint GUID, e.g. "{1d2f…}": what Equalizer APO's `Device:`
    /// lines match on, so each device can get its own EQ. None if unreadable.
    guid: Option<String>,
    name: String,
    /// A microphone or line in (true), or an output (false).
    input: bool,
    /// Windows' default output. Never set on an input: nothing here follows
    /// the default input.
    is_default: bool,
    /// None if Windows wouldn't tell us.
    volume: Option<Volume>,
    /// Equalizer APO's slots on this device, e.g. ["stream (SFX)"]. Empty = not loaded here.
    eapo: Vec<String>,
    format: Option<Format>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Volume {
    /// The device turns the volume down itself (true) or Windows scales the samples (false).
    hardware: bool,
    hardware_mute: bool,
    /// The Windows volume slider: as dB, and as the 0…100 the slider shows.
    db: f32,
    percent: f32,
    muted: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Format {
    sample_rate: u32,
    channels: u16,
    sample_format: String,
}

/// Every active audio output and input, with its diagnostics.
/// Async so it runs off the main thread (COM is set up for this thread here).
#[tauri::command]
pub async fn audio_devices() -> Result<Vec<DeviceInfo>, String> {
    // The command runs on a worker thread; COM must be initialised on it.
    // A second call on the same thread just reports "already done".
    // SAFETY: plain COM initialisation, no pointers involved.
    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };

    let host = cpal::default_host();
    let default_id = default_output_id(&host);
    let devices = host.devices().map_err(|e| e.to_string())?;
    Ok(devices.filter_map(|d| describe(&d, default_id.as_deref())).collect())
}

/// The id of Windows' current default output, if there is one.
pub fn default_output_id(host: &cpal::Host) -> Option<String> {
    host.default_output_device().and_then(|d| d.id().ok()).map(|id| id.to_string())
}

/// The output or input with this id (a specific device, not "whatever is default").
pub fn find_device(host: &cpal::Host, id: &str) -> Option<cpal::Device> {
    host.devices()
        .ok()?
        .find(|d| d.id().is_ok_and(|d_id| d_id.to_string() == id))
}

fn describe(device: &cpal::Device, default_id: Option<&str>) -> Option<DeviceInfo> {
    let id = device.id().ok()?.to_string();
    let name = device.description().map_or_else(|_| id.clone(), |d| d.name().to_string());
    let input = device.supports_input();
    let config = if input { device.default_input_config() } else { device.default_output_config() };
    let format = config.ok().map(|c| Format {
        sample_rate: c.sample_rate(),
        channels: c.channels(),
        sample_format: c.sample_format().to_string(),
    });
    let mm = immdevice(device);
    let guid = mm.as_ref().and_then(endpoint_guid);
    Some(DeviceInfo {
        is_default: default_id == Some(id.as_str()),
        volume: mm.as_ref().and_then(volume),
        eapo: guid.as_deref().map(|g| eapo_slots(g, input)).unwrap_or_default(),
        input,
        guid,
        format,
        id,
        name,
    })
}

fn immdevice(device: &cpal::Device) -> Option<IMMDevice> {
    match device.as_inner() {
        cpal::platform::DeviceInner::Wasapi(d) => d.immdevice(),
        #[allow(unreachable_patterns)]
        _ => None,
    }
}

fn volume(device: &IMMDevice) -> Option<Volume> {
    // SAFETY: COM calls on a valid device; the results are plain values.
    unsafe {
        let ep: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None).ok()?;
        let support = ep.QueryHardwareSupport().ok()?;
        Some(Volume {
            hardware: support & ENDPOINT_HARDWARE_SUPPORT_VOLUME != 0,
            hardware_mute: support & ENDPOINT_HARDWARE_SUPPORT_MUTE != 0,
            db: ep.GetMasterVolumeLevel().ok()?,
            percent: ep.GetMasterVolumeLevelScalar().ok()? * 100.0,
            muted: ep.GetMute().ok()?.as_bool(),
        })
    }
}

/// One output's Windows volume, read live so the capture can undo it.
///
/// Measured on a software-volume output, with music playing: loopback follows
/// the slider, but once the output is muted it delivers the sound at full
/// level, as if the slider were at 100%. Windows mutes when the slider reaches
/// 0, so "no sound at all" looked like "as loud as it gets". Windows mixes in
/// 32-bit float, so turning the sound back up here loses nothing.
///
/// Not `Send`: it stays on the capture thread that opened it.
pub struct OutputVolume {
    endpoint: IAudioEndpointVolume,
    hardware: bool,
}

impl OutputVolume {
    pub fn open(device: &cpal::Device) -> Option<Self> {
        let mm = immdevice(device)?;
        // SAFETY: plain COM initialisation, then COM calls on a valid device.
        // A second initialisation on this thread just reports "already done".
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let endpoint: IAudioEndpointVolume = mm.Activate(CLSCTX_ALL, None).ok()?;
            let support = endpoint.QueryHardwareSupport().ok()?;
            Some(Self { endpoint, hardware: support & ENDPOINT_HARDWARE_SUPPORT_VOLUME != 0 })
        }
    }

    /// What to multiply captured samples by, so they read the same wherever
    /// the slider is: 0 when muted or at zero (nothing is coming out), 1 when
    /// the device turns itself down (the slider never reached the samples),
    /// else the slider's gain undone. None if Windows wouldn't tell us.
    pub fn undo_gain(&self) -> Option<f32> {
        // SAFETY: COM calls on a valid endpoint; the results are plain values.
        unsafe {
            if self.endpoint.GetMute().ok()?.as_bool() || self.endpoint.GetMasterVolumeLevelScalar().ok()? <= 0.0 {
                return Some(0.0);
            }
            if self.hardware {
                return Some(1.0);
            }
            Some(10f32.powf(-self.endpoint.GetMasterVolumeLevel().ok()? / 20.0))
        }
    }
}

/// The endpoint GUID. The device id looks like "{0.0.0.00000000}.{guid}".
fn endpoint_guid(device: &IMMDevice) -> Option<String> {
    // SAFETY: GetId returns a string Windows allocated for us; we only read it.
    let full = unsafe { device.GetId() }.ok().and_then(|p| unsafe { p.to_string() }.ok())?;
    full.rsplit('.').next().map(str::to_string)
}

/// Which effect slots of this device (by endpoint GUID) load Equalizer APO.
fn eapo_slots(guid: &str, input: bool) -> Vec<String> {
    // The registry key is the endpoint GUID, under Render or Capture.
    let flow = if input { "Capture" } else { "Render" };
    let key = format!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\{flow}\{guid}\FxProperties");

    let mut slots = Vec::new();
    for (pid, slot) in FX_SLOTS {
        let Some(value) = read_reg_string(&key, &format!("{FX_KEY},{pid}")) else { continue };
        let value = value.to_ascii_uppercase();
        for (clsid, kind) in [(EAPO_PRE_MIX, "pre-mix"), (EAPO_POST_MIX, "post-mix")] {
            if value.contains(clsid) {
                let label = format!("{slot}, {kind} class");
                if !slots.contains(&label) {
                    slots.push(label);
                }
            }
        }
    }
    slots
}

/// A string (or list of strings, joined) from HKLM, or None if it isn't there.
pub(crate) fn read_reg_string(key: &str, value: &str) -> Option<String> {
    let key = HSTRING::from(key);
    let value = HSTRING::from(value);
    let flags = RRF_RT_REG_SZ | RRF_RT_REG_MULTI_SZ | RRF_SUBKEY_WOW6464KEY;
    let mut size = 0u32;
    // SAFETY: first call asks only for the size; second fills a buffer of exactly that size.
    unsafe {
        RegGetValueW(HKEY_LOCAL_MACHINE, PCWSTR(key.as_ptr()), PCWSTR(value.as_ptr()), flags, None, None, Some(&mut size))
            .ok()
            .ok()?;
        let mut buf = vec![0u16; (size as usize).div_ceil(2)];
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            PCWSTR(key.as_ptr()),
            PCWSTR(value.as_ptr()),
            flags,
            None,
            Some(buf.as_mut_ptr().cast()),
            Some(&mut size),
        )
        .ok()
        .ok()?;
        // Multi-strings are separated by NULs; turn them into spaces.
        let text: String = String::from_utf16_lossy(&buf).replace('\0', " ");
        Some(text.trim().to_string())
    }
}
