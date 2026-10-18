//! Safe LAN NAS discovery.
//!
//! The official Windows client exposes libzrpc_search_device, but its native
//! transport is not part of the recovered evidence. We therefore do not load
//! a private DLL or guess its broadcast protocol here. The fallback only
//! probes private IPv4 hosts belonging to the local interfaces and accepts a
//! device after the confirmed /key/pub?signme=1 response is parsed.

use crate::diagnostics;
use crate::nas::auth::{ApiResponse, NasPubKeyData};
use serde_json::from_str;
use std::net::Ipv4Addr;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use thiserror::Error;

pub const NAS_PORT: u16 = 5055;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DiscoveryConfig {
    pub timeout: Duration,
    pub max_concurrency: usize,
    pub max_hosts: usize,
}

impl Default for DiscoveryConfig {
    fn default() -> Self {
        Self {
            timeout: Duration::from_millis(450),
            max_concurrency: 32,
            max_hosts: 1024,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct DiscoveryCancellation(Arc<AtomicBool>);

impl DiscoveryCancellation {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiscoveryBackend {
    HttpFallback,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeSdkStatus {
    Unavailable,
    DetectedButNotIntegrated,
}

/// Checks only an explicitly configured SDK path. The private SDK is never
/// loaded implicitly because its ABI and discovery transport are unverified.
pub fn native_sdk_status() -> NativeSdkStatus {
    let Some(path) = std::env::var_os("Z_VIDEO_ZRPC_SDK") else {
        return NativeSdkStatus::Unavailable;
    };
    if Path::new(&path).is_file() {
        NativeSdkStatus::DetectedButNotIntegrated
    } else {
        NativeSdkStatus::Unavailable
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NasDiscoveryResult {
    pub ip: Ipv4Addr,
    pub name: Option<String>,
    /// The fallback endpoint does not prove the official SDK's nas_id.
    pub nas_id: Option<String>,
    /// sign from /key/pub is kept separate from nas_id.
    pub nas_sign: Option<String>,
    pub available: bool,
    pub source: DiscoveryBackend,
}

impl NasDiscoveryResult {
    pub fn base_url(&self) -> String {
        format!("http://{}:{NAS_PORT}", self.ip)
    }
}

#[derive(Debug, Clone)]
pub struct DiscoveryReport {
    pub results: Vec<NasDiscoveryResult>,
    pub candidate_count: usize,
    pub truncated: bool,
    pub backend: DiscoveryBackend,
    pub native_sdk_status: NativeSdkStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiscoveryErrorClass {
    Configuration,
    NoLocalNetwork,
    Timeout,
    Network,
    MalformedResponse,
    Business,
    Cancelled,
}

#[derive(Debug, Error)]
pub enum DiscoveryError {
    #[error("扫描配置无效: {0}")]
    Configuration(String),
    #[error("没有可扫描的本机私有 IPv4 网段: {0}")]
    NoLocalNetwork(String),
    #[error("扫描已取消")]
    Cancelled,
    #[error("发现请求超时")]
    Timeout,
    #[error("发现请求失败: {0}")]
    Network(String),
    #[error("NAS 发现响应解析失败: {0}")]
    MalformedResponse(String),
    #[error("NAS 发现业务响应错误 ({code}): {message}")]
    Business { code: String, message: String },
}

impl DiscoveryError {
    pub fn class(&self) -> DiscoveryErrorClass {
        match self {
            Self::Configuration(_) => DiscoveryErrorClass::Configuration,
            Self::NoLocalNetwork(_) => DiscoveryErrorClass::NoLocalNetwork,
            Self::Cancelled => DiscoveryErrorClass::Cancelled,
            Self::Timeout => DiscoveryErrorClass::Timeout,
            Self::Network(_) => DiscoveryErrorClass::Network,
            Self::MalformedResponse(_) => DiscoveryErrorClass::MalformedResponse,
            Self::Business { .. } => DiscoveryErrorClass::Business,
        }
    }

    pub fn user_recovery_hint(&self) -> String {
        match self {
            Self::Configuration(message) => format!("扫描配置无效：{}。", message),
            Self::NoLocalNetwork(message) => format!(
                "未发现可扫描的本机私有局域网：{}。请确认电脑已连接 Wi-Fi/网线，或手动输入 NAS 地址。",
                message
            ),
            Self::Cancelled => "已取消 NAS 扫描。".to_string(),
            Self::Timeout => "NAS 扫描超时。请确认 NAS 与电脑在同一局域网后重试。".to_string(),
            Self::Network(message) => {
                format!("NAS 扫描失败：{}。请确认 NAS 与电脑在同一局域网。", message)
            }
            Self::MalformedResponse(message) => {
                format!("发现到设备但响应格式无法识别：{}。", message)
            }
            Self::Business { code, message } => {
                format!("设备返回发现错误（{}）：{}。", code, message)
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ipv4Network {
    pub address: Ipv4Addr,
    pub prefix_len: u8,
}

/// Builds the only fallback request that is used to confirm a NAS host.
pub fn build_probe_url(ip: Ipv4Addr) -> String {
    format!("http://{ip}:{NAS_PORT}/key/pub?signme=1")
}

/// Parses the confirmed NAS public-key response without treating sign as the
/// SDK's nas_id.
pub fn parse_probe_response(
    body: &str,
    ip: Ipv4Addr,
) -> Result<NasDiscoveryResult, DiscoveryError> {
    let response: ApiResponse<NasPubKeyData> = from_str(body).map_err(|error| {
        DiscoveryError::MalformedResponse(format!("JSON 结构无效: {}", error))
    })?;

    if !response.is_success() {
        return Err(DiscoveryError::Business {
            code: response.code_str(),
            message: response.error_message(),
        });
    }

    let data = response
        .data
        .ok_or_else(|| DiscoveryError::MalformedResponse("响应缺少 data".to_string()))?;
    if data.key.trim().is_empty() {
        return Err(DiscoveryError::MalformedResponse(
            "响应缺少有效 NAS 公钥".to_string(),
        ));
    }

    Ok(NasDiscoveryResult {
        ip,
        name: data.name.filter(|name| !name.trim().is_empty()),
        nas_id: None,
        nas_sign: data.sign.filter(|sign| !sign.trim().is_empty()),
        available: true,
        source: DiscoveryBackend::HttpFallback,
    })
}

/// Parses ipconfig output. This is intentionally pure so the local-network
/// boundary can be tested without sending probes.
pub fn parse_local_ipv4_networks(output: &str) -> Vec<Ipv4Network> {
    let mut address = None;
    let mut networks = Vec::new();

    for line in output.lines() {
        let lower = line.to_ascii_lowercase();
        let values = ipv4_values(line);
        if (lower.contains("ipv4") || lower.contains("ip address") || line.contains("IPv4 地址"))
            && !values.is_empty()
        {
            address = values.first().copied();
        }

        let is_mask = lower.contains("subnet mask") || line.contains("子网掩码");
        if is_mask {
            if let (Some(ip), Some(mask)) = (address, values.first().copied()) {
                if ip.is_private() {
                    if let Some(prefix_len) = prefix_len(mask) {
                        let network = Ipv4Network {
                            address: ip,
                            prefix_len,
                        };
                        if !networks.contains(&network) {
                            networks.push(network);
                        }
                    }
                }
            }
            address = None;
        }
    }

    networks
}

pub fn classify_probe_error_message(message: &str) -> DiscoveryErrorClass {
    let lower = message.to_ascii_lowercase();
    if lower.contains("timeout") || lower.contains("timed out") || message.contains("超时") {
        DiscoveryErrorClass::Timeout
    } else {
        DiscoveryErrorClass::Network
    }
}

/// Discovers NAS devices using a bounded HTTP fallback on local private IPv4
/// networks. It never scans public addresses and never sends credentials.
pub fn discover_local_nas(
    config: DiscoveryConfig,
    cancellation: DiscoveryCancellation,
) -> Result<DiscoveryReport, DiscoveryError> {
    validate_config(config)?;
    let operation = diagnostics::start_event("discovery", "nas.scan");
    let sdk_status = native_sdk_status();

    let networks = match local_ipv4_networks() {
        Ok(networks) => networks,
        Err(error) => {
            operation.finish(
                "error",
                &[("error_class", format!("{:?}", error.class()))],
            );
            return Err(error);
        }
    };

    if cancellation.is_cancelled() {
        operation.finish("cancelled", &[("reason", "user_cancelled".to_string())]);
        return Err(DiscoveryError::Cancelled);
    }

    let (candidates, truncated) = expand_candidates(&networks, config.max_hosts);
    if candidates.is_empty() {
        let error =
            DiscoveryError::NoLocalNetwork("网卡地址不是私有 IPv4 或没有可用主机".to_string());
        operation.finish(
            "error",
            &[("error_class", format!("{:?}", error.class()))],
        );
        return Err(error);
    }

    let candidate_count = candidates.len();
    let shared_candidates = Arc::new(candidates);
    let next = Arc::new(AtomicUsize::new(0));
    let results = Arc::new(Mutex::new(Vec::new()));
    let worker_count = config.max_concurrency.min(candidate_count);
    let mut workers = Vec::with_capacity(worker_count);

    for _ in 0..worker_count {
        let shared_candidates = Arc::clone(&shared_candidates);
        let next = Arc::clone(&next);
        let results = Arc::clone(&results);
        let cancellation = cancellation.clone();
        workers.push(std::thread::spawn(move || {
            let agent = ureq::AgentBuilder::new().timeout(config.timeout).build();
            loop {
                if cancellation.is_cancelled() {
                    return;
                }
                let index = next.fetch_add(1, Ordering::Relaxed);
                let Some(ip) = shared_candidates.get(index).copied() else {
                    return;
                };
                if let Ok(result) = probe_host(&agent, ip) {
                    results.lock().unwrap().push(result);
                }
            }
        }));
    }

    for worker in workers {
        let _ = worker.join();
    }

    if cancellation.is_cancelled() {
        operation.finish("cancelled", &[("reason", "user_cancelled".to_string())]);
        return Err(DiscoveryError::Cancelled);
    }

    let mut discovered = results.lock().unwrap().clone();
    discovered.sort_by_key(|result: &NasDiscoveryResult| result.ip);
    let result_count = discovered.len();
    operation.finish(
        "success",
        &[
            ("backend", "http_fallback".to_string()),
            ("count", result_count.to_string()),
            ("candidate_count", candidate_count.to_string()),
        ],
    );

    Ok(DiscoveryReport {
        results: discovered,
        candidate_count,
        truncated,
        backend: DiscoveryBackend::HttpFallback,
        native_sdk_status: sdk_status,
    })
}

fn validate_config(config: DiscoveryConfig) -> Result<(), DiscoveryError> {
    if config.timeout.is_zero() {
        return Err(DiscoveryError::Configuration(
            "超时时间必须大于 0".to_string(),
        ));
    }
    if config.max_concurrency == 0 {
        return Err(DiscoveryError::Configuration(
            "并发上限必须大于 0".to_string(),
        ));
    }
    if config.max_hosts == 0 {
        return Err(DiscoveryError::Configuration(
            "扫描主机上限必须大于 0".to_string(),
        ));
    }
    Ok(())
}

fn probe_host(agent: &ureq::Agent, ip: Ipv4Addr) -> Result<NasDiscoveryResult, DiscoveryError> {
    let started_at = Instant::now();
    let response = match agent.get(&build_probe_url(ip)).call() {
        Ok(response) => response,
        Err(error) => {
            let error_class = match &error {
                ureq::Error::Status(status, _) if *status == 401 || *status == 403 => "business",
                ureq::Error::Status(_, _) => "network",
                ureq::Error::Transport(transport) => {
                    match classify_probe_error_message(&transport.to_string()) {
                        DiscoveryErrorClass::Timeout => "timeout",
                        _ => "network",
                    }
                }
            };
            diagnostics::record_nas_request(
                "discovery.probe",
                "GET",
                "/key/pub?signme=1",
                match &error {
                    ureq::Error::Status(status, _) => Some(*status),
                    ureq::Error::Transport(_) => None,
                },
                started_at.elapsed(),
                "error",
                "not_parsed",
                "not_checked",
                Some(error_class),
            );
            return Err(match error {
                ureq::Error::Status(status, _) => {
                    DiscoveryError::Network(format!("HTTP {}", status))
                }
                ureq::Error::Transport(transport) => {
                    match classify_probe_error_message(&transport.to_string()) {
                        DiscoveryErrorClass::Timeout => DiscoveryError::Timeout,
                        _ => DiscoveryError::Network("连接失败".to_string()),
                    }
                }
            });
        }
    };

    let status = response.status();
    let body = response.into_string().map_err(|_error| {
        diagnostics::record_nas_request(
            "discovery.probe",
            "GET",
            "/key/pub?signme=1",
            Some(status),
            started_at.elapsed(),
            "error",
            "body_read_error",
            "not_checked",
            Some("network"),
        );
        DiscoveryError::Network("无法读取设备响应".to_string())
    })?;

    let parsed = parse_probe_response(&body, ip);
    let (parse_result, business_result, error_class) = match &parsed {
        Ok(_) => ("success", "success", None),
        Err(error) => match error.class() {
            DiscoveryErrorClass::Business => ("success", "error", Some("business")),
            DiscoveryErrorClass::MalformedResponse => ("error", "not_checked", Some("parse")),
            _ => ("error", "not_checked", Some("network")),
        },
    };
    diagnostics::record_nas_request(
        "discovery.probe",
        "GET",
        "/key/pub?signme=1",
        Some(status),
        started_at.elapsed(),
        if parsed.is_ok() { "success" } else { "error" },
        parse_result,
        business_result,
        error_class,
    );
    parsed
}

#[cfg(windows)]
fn local_ipv4_networks() -> Result<Vec<Ipv4Network>, DiscoveryError> {
    let output = Command::new("ipconfig")
        .output()
        .map_err(|error| DiscoveryError::NoLocalNetwork(format!("无法读取本机网卡信息: {}", error)))?;
    if !output.status.success() {
        return Err(DiscoveryError::NoLocalNetwork(
            "ipconfig 未返回成功状态".to_string(),
        ));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let networks = parse_local_ipv4_networks(&text);
    if networks.is_empty() {
        Err(DiscoveryError::NoLocalNetwork(
            "未找到私有 IPv4 地址和子网掩码".to_string(),
        ))
    } else {
        Ok(networks)
    }
}

#[cfg(not(windows))]
fn local_ipv4_networks() -> Result<Vec<Ipv4Network>, DiscoveryError> {
    Err(DiscoveryError::NoLocalNetwork(
        "当前平台没有接入本机网卡枚举适配".to_string(),
    ))
}

fn expand_candidates(networks: &[Ipv4Network], max_hosts: usize) -> (Vec<Ipv4Addr>, bool) {
    let mut candidates = Vec::new();
    let mut truncated = false;

    for network in networks {
        if network.prefix_len > 30 || candidates.len() >= max_hosts {
            truncated = true;
            break;
        }
        let mask = if network.prefix_len == 0 {
            0
        } else {
            u32::MAX << (32 - network.prefix_len)
        };
        let network_address = u32::from(network.address) & mask;
        let host_count = (1u64 << (32 - network.prefix_len)).saturating_sub(2);
        for offset in 1..=host_count {
            if candidates.len() >= max_hosts {
                truncated = true;
                break;
            }
            candidates.push(Ipv4Addr::from(network_address + offset as u32));
        }
    }

    (candidates, truncated)
}

fn ipv4_values(line: &str) -> Vec<Ipv4Addr> {
    line.split(|character: char| !character.is_ascii_digit() && character != '.')
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse().ok())
        .collect()
}

fn prefix_len(mask: Ipv4Addr) -> Option<u8> {
    let bits = u32::from(mask);
    let prefix = bits.leading_ones() as u8;
    if prefix == 0 || bits == u32::MAX << (32 - prefix as u32) {
        Some(prefix)
    } else {
        None
    }
}
