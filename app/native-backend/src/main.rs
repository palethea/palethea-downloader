use std::{
    collections::{BTreeMap, HashMap},
    env,
    net::SocketAddr,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
};

use axum::{
    Json, Router,
    body::Body,
    extract::{Path as AxumPath, Query, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{Local, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::{
    fs,
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    sync::RwLock,
};
use tokio_util::io::ReaderStream;
use tower_http::cors::{Any, CorsLayer};
use tracing::{error, info, warn};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    jobs: Arc<RwLock<HashMap<String, JobRecord>>>,
    download_dir: Arc<PathBuf>,
    cookies_from_browser: Option<String>,
    http_client: reqwest::Client,
}

#[derive(Clone, Serialize, Deserialize)]
struct InspectRequest {
    url: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct CreateJobRequest {
    url: String,
    format: String,
    quality: String,
}

#[derive(Clone, Deserialize)]
struct ThumbnailQuery {
    url: String,
    referer: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
struct HealthResponse {
    status: String,
    #[serde(rename = "queueDepth")]
    queue_depth: usize,
    time: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct FormatInfo {
    qualities: Vec<String>,
    #[serde(rename = "defaultQuality")]
    default_quality: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct InspectResponse {
    id: String,
    source: String,
    title: String,
    duration: u64,
    #[serde(rename = "thumbnailUrl")]
    thumbnail_url: String,
    channel: String,
    #[serde(rename = "webpageUrl")]
    webpage_url: String,
    #[serde(rename = "availableFormats")]
    available_formats: BTreeMap<String, FormatInfo>,
    #[serde(rename = "estimatedSizes")]
    estimated_sizes: BTreeMap<String, BTreeMap<String, u64>>,
    #[serde(rename = "frameRates")]
    frame_rates: BTreeMap<String, f64>,
}

#[derive(Clone, Serialize, Deserialize)]
struct JobEnvelope {
    job: Job,
    #[serde(rename = "queuePosition")]
    queue_position: usize,
    #[serde(rename = "statusUrl")]
    status_url: String,
    #[serde(rename = "downloadUrl")]
    download_url: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct JobRecord {
    job: Job,
    file_path: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
struct Job {
    id: String,
    status: String,
    stage: String,
    progress: u8,
    url: String,
    format: String,
    quality: String,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    title: String,
    duration: u64,
    #[serde(rename = "thumbnailUrl")]
    thumbnail_url: String,
    source: String,
    #[serde(rename = "downloadUrl")]
    download_url: Option<String>,
    #[serde(rename = "fileName")]
    file_name: Option<String>,
    #[serde(rename = "fileSize")]
    file_size: Option<u64>,
    #[serde(rename = "retainedUntil")]
    retained_until: Option<String>,
    error: Option<ApiErrorBody>,
}

#[derive(Clone, Serialize, Deserialize)]
struct ApiErrorBody {
    code: String,
    message: String,
    details: BTreeMap<String, String>,
}

#[derive(Serialize)]
struct ErrorEnvelope {
    error: ApiErrorBody,
}

struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
    details: BTreeMap<String, String>,
}

impl ApiError {
    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
            details: BTreeMap::new(),
        }
    }

    fn with_detail(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.details.insert(key.into(), value.into());
        self
    }

    fn from_job_error(status: StatusCode, err: &ApiErrorBody) -> Self {
        Self {
            status,
            code: Box::leak(err.code.clone().into_boxed_str()),
            message: err.message.clone(),
            details: err.details.clone(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = Json(ErrorEnvelope {
            error: ApiErrorBody {
                code: self.code.to_string(),
                message: self.message,
                details: self.details,
            },
        });
        (self.status, body).into_response()
    }
}

#[tokio::main]
async fn main() {
    init_logging();
    verify_binary("ffmpeg", "-version").await;
    verify_binary("yt-dlp", "--version").await;

    let download_dir = env::var("PALETHEA_DOWNLOAD_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| default_download_dir());

    if let Err(err) = fs::create_dir_all(&download_dir).await {
        panic!(
            "failed to create download dir {}: {err}",
            download_dir.display()
        );
    }

    info!(path = %download_dir.display(), "using Palethea library directory");

    let cookies_from_browser = env::var("PALETHEA_COOKIES_FROM_BROWSER").ok();
    if let Some(browser) = &cookies_from_browser {
        info!(browser, "using browser cookies for local yt-dlp requests");
    }

    let state = AppState {
        jobs: Arc::new(RwLock::new(HashMap::new())),
        download_dir: Arc::new(download_dir),
        cookies_from_browser,
        http_client: reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::limited(5))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36")
            .build()
            .expect("build thumbnail http client"),
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS, Method::HEAD])
        .allow_headers(Any);

    let app = Router::new()
        .route("/media-api/health", get(health))
        .route("/media-api/inspect", post(inspect_handler))
        .route("/media-api/thumbnail", get(thumbnail_handler))
        .route("/media-api/jobs", post(create_job_handler))
        .route("/media-api/jobs/{id}", get(get_job_handler))
        .route(
            "/media-api/library/{file_name}",
            get(library_file_get_handler).head(library_file_head_handler),
        )
        .route(
            "/media-api/jobs/{id}/download",
            get(download_get_handler).head(download_head_handler),
        )
        .with_state(state)
        .layer(cors);

    let addr = SocketAddr::from(([127, 0, 0, 1], 43125));
    info!(%addr, "palethea native backend listening");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind listener");
    axum::serve(listener, app).await.expect("serve backend");
}

fn default_download_dir() -> PathBuf {
    env::current_dir()
        .unwrap_or_else(|_| env::temp_dir())
        .join("library")
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let jobs = state.jobs.read().await;
    let queue_depth = jobs
        .values()
        .filter(|record| matches!(record.job.status.as_str(), "queued" | "processing"))
        .count();

    Json(HealthResponse {
        status: "ok".to_string(),
        queue_depth,
        time: Local::now().to_rfc3339(),
    })
}

async fn thumbnail_handler(
    State(state): State<AppState>,
    Query(query): Query<ThumbnailQuery>,
) -> Result<Response, ApiError> {
    let thumbnail_url = query.url.trim();
    if !is_supported_remote_thumbnail_url(thumbnail_url) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "INVALID_URL",
            "That thumbnail URL is not supported.",
        ));
    }

    let mut request = state.http_client.get(thumbnail_url).header(
        reqwest::header::ACCEPT,
        "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    );

    if let Some(referer) = query
        .referer
        .as_deref()
        .map(str::trim)
        .filter(|referer| is_supported_page_url(referer))
        .map(str::to_string)
        .or_else(|| default_referer_for_thumbnail_url(thumbnail_url))
    {
        if let Ok(value) = HeaderValue::from_str(&referer) {
            request = request.header(reqwest::header::REFERER, value);
        }

        if let Ok(parsed) = url::Url::parse(&referer) {
            let origin = format!(
                "{}://{}",
                parsed.scheme(),
                parsed.host_str().unwrap_or_default()
            );
            if let Ok(value) = HeaderValue::from_str(&origin) {
                request = request.header(reqwest::header::ORIGIN, value);
            }
        }
    }

    let response = request.send().await.map_err(|_| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            "THUMBNAIL_FETCH_FAILED",
            "Could not load the thumbnail preview.",
        )
    })?;

    if !response.status().is_success() {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            "THUMBNAIL_FETCH_FAILED",
            "Could not load the thumbnail preview.",
        ));
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();
    let body = response.bytes().await.map_err(|_| {
        ApiError::new(
            StatusCode::BAD_GATEWAY,
            "THUMBNAIL_FETCH_FAILED",
            "Could not load the thumbnail preview.",
        )
    })?;

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&content_type).unwrap_or(HeaderValue::from_static("image/jpeg")),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=86400"),
    );

    Ok((headers, body).into_response())
}

async fn inspect_handler(
    State(state): State<AppState>,
    Json(payload): Json<InspectRequest>,
) -> Result<Json<InspectResponse>, ApiError> {
    let url = sanitize_supported_url(&payload.url)?;
    let info = fetch_media_info(&url, state.cookies_from_browser.as_deref()).await?;
    Ok(Json(build_inspect_response(info)?))
}

async fn create_job_handler(
    State(state): State<AppState>,
    Json(payload): Json<CreateJobRequest>,
) -> Result<Json<JobEnvelope>, ApiError> {
    let url = sanitize_supported_url(&payload.url)?;
    let format = payload.format.to_lowercase();
    if format != "mp3" && format != "mp4" {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "UNSUPPORTED_VIDEO",
            "Only mp3 and mp4 formats are supported.",
        ));
    }

    let info = fetch_media_info(&url, state.cookies_from_browser.as_deref()).await?;
    let inspect = build_inspect_response(info.clone())?;
    let available = inspect.available_formats.get(&format).ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "UNSUPPORTED_VIDEO",
            "The selected format is not available for this media.",
        )
    })?;

    if !available
        .qualities
        .iter()
        .any(|item| item == &payload.quality)
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "QUALITY_NOT_SUPPORTED",
            "The requested quality is not available for this media.",
        ));
    }

    let job_id = Uuid::new_v4().simple().to_string();
    let now = Utc::now().to_rfc3339();
    let job = Job {
        id: job_id.clone(),
        status: "queued".to_string(),
        stage: "queued".to_string(),
        progress: 0,
        url: url.clone(),
        format: format.clone(),
        quality: payload.quality.clone(),
        created_at: now.clone(),
        updated_at: now,
        title: inspect.title.clone(),
        duration: inspect.duration,
        thumbnail_url: inspect.thumbnail_url.clone(),
        source: inspect.source.clone(),
        download_url: None,
        file_name: None,
        file_size: None,
        retained_until: None,
        error: None,
    };

    {
        let mut jobs = state.jobs.write().await;
        jobs.insert(
            job_id.clone(),
            JobRecord {
                job: job.clone(),
                file_path: None,
            },
        );
    }

    let queue_position = {
        let jobs = state.jobs.read().await;
        jobs.values()
            .filter(|record| record.job.status == "queued")
            .count()
    };

    let state_for_task = state.clone();
    let info_for_task = info.clone();
    let quality = payload.quality.clone();
    tokio::spawn(async move {
        if let Err(err) = process_job(
            state_for_task,
            job_id.clone(),
            url,
            format,
            quality,
            info_for_task,
        )
        .await
        {
            error!(job_id, error = %err.message, "job failed");
        }
    });

    Ok(Json(JobEnvelope {
        job: job.clone(),
        queue_position,
        status_url: format!("http://127.0.0.1:43125/media-api/jobs/{}", job.id),
        download_url: format!("http://127.0.0.1:43125/media-api/jobs/{}/download", job.id),
    }))
}

async fn get_job_handler(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<Job>, ApiError> {
    let jobs = state.jobs.read().await;
    let record = jobs.get(&id).ok_or_else(|| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            "JOB_NOT_FOUND",
            "This conversion job could not be found.",
        )
    })?;
    Ok(Json(record.job.clone()))
}

async fn download_head_handler(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Response, ApiError> {
    let (job, file_path) = get_download_ready_job(&state, &id).await?;
    let inline = params.contains_key("stream");
    let file_name = job.file_name.as_deref().ok_or_else(|| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "Missing file name for completed download.",
        )
    })?;
    let mut headers = build_download_headers(file_name, &file_path, inline).await?;
    headers.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&job.file_size.unwrap_or(0).to_string()).unwrap(),
    );
    Ok((StatusCode::OK, headers, Body::empty()).into_response())
}

async fn download_get_handler(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Response, ApiError> {
    let (job, file_path) = get_download_ready_job(&state, &id).await?;
    let inline = params.contains_key("stream");
    let file_name = job.file_name.as_deref().ok_or_else(|| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "Missing file name for completed download.",
        )
    })?;
    let headers = build_download_headers(file_name, &file_path, inline).await?;
    let file = fs::File::open(&file_path).await.map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "Could not open the generated download file.",
        )
    })?;
    let stream = ReaderStream::new(file);
    Ok((StatusCode::OK, headers, Body::from_stream(stream)).into_response())
}

async fn library_file_head_handler(
    State(state): State<AppState>,
    AxumPath(file_name): AxumPath<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Response, ApiError> {
    let file_path = find_download_file_by_name(&state.download_dir, &file_name)
        .await
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "DOWNLOAD_NOT_FOUND",
                "This downloaded file could not be found on disk.",
            )
        })?;
    let inline = params.contains_key("stream");
    let headers = build_download_headers(&file_name, &file_path, inline).await?;
    Ok((StatusCode::OK, headers, Body::empty()).into_response())
}

async fn library_file_get_handler(
    State(state): State<AppState>,
    AxumPath(file_name): AxumPath<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Response, ApiError> {
    let file_path = find_download_file_by_name(&state.download_dir, &file_name)
        .await
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "DOWNLOAD_NOT_FOUND",
                "This downloaded file could not be found on disk.",
            )
        })?;
    let inline = params.contains_key("stream");
    let headers = build_download_headers(&file_name, &file_path, inline).await?;
    let file = fs::File::open(&file_path).await.map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "Could not open the downloaded file.",
        )
    })?;
    let stream = ReaderStream::new(file);
    Ok((StatusCode::OK, headers, Body::from_stream(stream)).into_response())
}

async fn get_download_ready_job(state: &AppState, id: &str) -> Result<(Job, PathBuf), ApiError> {
    let jobs = state.jobs.read().await;
    let record = jobs.get(id).ok_or_else(|| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            "JOB_NOT_FOUND",
            "This conversion job could not be found.",
        )
    })?;

    match record.job.status.as_str() {
        "completed" => {
            let path = record
                .file_path
                .as_ref()
                .map(PathBuf::from)
                .ok_or_else(|| {
                    ApiError::new(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "INTERNAL_ERROR",
                        "The completed file path is missing.",
                    )
                })?;
            Ok((record.job.clone(), path))
        }
        "failed" => {
            if let Some(err) = &record.job.error {
                Err(ApiError::from_job_error(StatusCode::CONFLICT, err))
            } else {
                Err(ApiError::new(
                    StatusCode::CONFLICT,
                    "CONVERSION_FAILED",
                    "The conversion failed.",
                ))
            }
        }
        "expired" => Err(ApiError::new(
            StatusCode::GONE,
            "DOWNLOAD_EXPIRED",
            "This download has expired.",
        )),
        _ => Err(ApiError::new(
            StatusCode::CONFLICT,
            "DOWNLOAD_NOT_READY",
            "The requested download is not ready yet.",
        )),
    }
}

async fn build_download_headers(
    file_name: &str,
    file_path: &Path,
    inline: bool,
) -> Result<HeaderMap, ApiError> {
    let metadata = fs::metadata(file_path).await.map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "Could not read file metadata.",
        )
    })?;
    let mime = mime_guess::from_path(file_path).first_or_octet_stream();

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.as_ref()).unwrap(),
    );
    headers.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&metadata.len().to_string()).unwrap(),
    );
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    let disposition = if inline {
        format!(
            "inline; filename*=utf-8''{}",
            urlencoding::encode(file_name)
        )
    } else {
        format!(
            "attachment; filename*=utf-8''{}",
            urlencoding::encode(file_name)
        )
    };
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&disposition).unwrap(),
    );
    Ok(headers)
}

async fn find_download_file_by_name(root: &Path, file_name: &str) -> Option<PathBuf> {
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let mut entries = fs::read_dir(&dir).await.ok()?;
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            let file_type = entry.file_type().await.ok()?;

            if file_type.is_dir() {
                stack.push(path);
                continue;
            }

            if file_type.is_file()
                && path
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy() == file_name)
            {
                return Some(path);
            }
        }
    }

    None
}

async fn process_job(
    state: AppState,
    job_id: String,
    url: String,
    format: String,
    quality: String,
    info: Value,
) -> Result<(), ApiError> {
    update_job(&state, &job_id, |job| {
        job.status = "processing".to_string();
        job.stage = "downloading".to_string();
        job.progress = 1;
        job.updated_at = Utc::now().to_rfc3339();
    })
    .await?;

    let job_dir = state.download_dir.join(&job_id);
    fs::create_dir_all(&job_dir).await.map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "Could not create output directory.",
        )
    })?;

    let output_template = job_dir.join("%(title).180B-%(id)s.%(ext)s");
    let mut command = Command::new("yt-dlp");
    command.arg("--no-playlist").arg("--newline");
    if let Some(browser) = state.cookies_from_browser.as_deref() {
        command.arg("--cookies-from-browser").arg(browser);
    }

    if format == "mp3" {
        let bitrate = quality.trim_end_matches('k');
        command
            .arg("-x")
            .arg("--audio-format")
            .arg("mp3")
            .arg("--postprocessor-args")
            .arg(format!("ExtractAudio:-b:a {}k", bitrate));
    } else {
        let height = quality.trim_end_matches('p');
        command
            .arg("-f")
            .arg(format!("bv*[height<={0}]+ba/b[height<={0}]", height))
            .arg("--merge-output-format")
            .arg("mp4");
    }

    command
        .arg("-o")
        .arg(output_template.to_string_lossy().to_string())
        .arg(&url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "Failed to start yt-dlp locally. Ensure yt-dlp is installed and available in PATH.",
        )
    })?;

    let stdout = child.stdout.take().expect("child stdout");
    let stderr = child.stderr.take().expect("child stderr");
    let mut stdout_lines = BufReader::new(stdout).lines();
    let mut stderr_lines = BufReader::new(stderr).lines();

    loop {
        tokio::select! {
            line = stdout_lines.next_line() => {
                match line {
                    Ok(Some(line)) => handle_progress_line(&state, &job_id, &line).await?,
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
            line = stderr_lines.next_line() => {
                match line {
                    Ok(Some(line)) => handle_progress_line(&state, &job_id, &line).await?,
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
        }
    }

    let status = child.wait().await.map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "Local conversion process crashed unexpectedly.",
        )
    })?;

    if !status.success() {
        let reason = format!("yt-dlp exited with status {}", status.code().unwrap_or(-1));
        fail_job(
            &state,
            &job_id,
            "CONVERSION_FAILED",
            "The local conversion failed.",
            reason,
        )
        .await?;
        return Ok(());
    }

    update_job(&state, &job_id, |job| {
        job.stage = "ready".to_string();
        job.progress = job.progress.max(95);
        job.updated_at = Utc::now().to_rfc3339();
    })
    .await?;

    let mut output_file = find_download_file(&job_dir).await.ok_or_else(|| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "Could not find the generated output file.",
        )
    })?;

    if format == "mp4" {
        update_job(&state, &job_id, |job| {
            job.stage = "converting".to_string();
            job.progress = job.progress.max(92);
            job.updated_at = Utc::now().to_rfc3339();
        })
        .await?;

        output_file = normalize_mp4_for_playback(&output_file)
            .await
            .map_err(|error| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "INTERNAL_ERROR",
                    format!(
                        "Could not finalize the MP4 for playback compatibility: {}",
                        error
                    ),
                )
            })?;
    }

    let metadata = fs::metadata(&output_file).await.map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "Could not read the output file metadata.",
        )
    })?;

    let file_name = output_file
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| format!("{}.{}", job_id, format));

    let retained_until = (Utc::now() + chrono::Duration::hours(12)).to_rfc3339();
    let download_url = format!("http://127.0.0.1:43125/media-api/jobs/{}/download", job_id);

    {
        let mut jobs = state.jobs.write().await;
        if let Some(record) = jobs.get_mut(&job_id) {
            record.file_path = Some(output_file.to_string_lossy().to_string());
            record.job.status = "completed".to_string();
            record.job.stage = "ready".to_string();
            record.job.progress = 100;
            record.job.updated_at = Utc::now().to_rfc3339();
            record.job.download_url = Some(download_url);
            record.job.file_name = Some(file_name);
            record.job.file_size = Some(metadata.len());
            record.job.retained_until = Some(retained_until);
            record.job.error = None;
        }
    }

    let _ = info;
    Ok(())
}

async fn handle_progress_line(state: &AppState, job_id: &str, line: &str) -> Result<(), ApiError> {
    if let Some(percent) = parse_percent(line) {
        let mapped = ((percent / 100.0) * 80.0).round() as u8;
        update_job(state, job_id, |job| {
            job.stage = "downloading".to_string();
            job.progress = job.progress.max(mapped.max(1));
            job.updated_at = Utc::now().to_rfc3339();
        })
        .await?;
    }

    let lower = line.to_lowercase();
    if lower.contains("merg")
        || lower.contains("extractaudio")
        || lower.contains("ffmpeg")
        || lower.contains("post-process")
    {
        update_job(state, job_id, |job| {
            job.stage = "converting".to_string();
            job.progress = job.progress.max(85);
            job.updated_at = Utc::now().to_rfc3339();
        })
        .await?;
    }

    Ok(())
}

async fn update_job<F>(state: &AppState, job_id: &str, mut updater: F) -> Result<(), ApiError>
where
    F: FnMut(&mut Job),
{
    let mut jobs = state.jobs.write().await;
    let record = jobs.get_mut(job_id).ok_or_else(|| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            "JOB_NOT_FOUND",
            "This conversion job could not be found.",
        )
    })?;
    updater(&mut record.job);
    Ok(())
}

async fn fail_job(
    state: &AppState,
    job_id: &str,
    code: &str,
    message: &str,
    reason: String,
) -> Result<(), ApiError> {
    let mut jobs = state.jobs.write().await;
    let record = jobs.get_mut(job_id).ok_or_else(|| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            "JOB_NOT_FOUND",
            "This conversion job could not be found.",
        )
    })?;
    record.job.status = "failed".to_string();
    record.job.stage = "failed".to_string();
    record.job.updated_at = Utc::now().to_rfc3339();
    record.job.error = Some(ApiErrorBody {
        code: code.to_string(),
        message: message.to_string(),
        details: BTreeMap::from([("reason".to_string(), reason)]),
    });
    Ok(())
}

fn build_inspect_response(info: Value) -> Result<InspectResponse, ApiError> {
    let id = info
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "UNSUPPORTED_VIDEO",
                "Missing media id in yt-dlp response.",
            )
        })?
        .to_string();
    let title = info
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Unknown title")
        .to_string();
    let duration = parse_duration_seconds(&info);
    let thumbnail_url = extract_thumbnail_url(&info);
    let channel = info
        .get("channel")
        .or_else(|| info.get("uploader"))
        .and_then(Value::as_str)
        .unwrap_or("Unknown channel")
        .to_string();
    let webpage_url = info
        .get("webpage_url")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let source = detect_source_from_info(&info);
    let mp4_qualities = collect_mp4_qualities(&info);
    let frame_rates = collect_mp4_frame_rates(&info, &mp4_qualities);
    let mp3_qualities = vec!["320k".to_string(), "192k".to_string(), "128k".to_string()];

    let mut available_formats = BTreeMap::new();
    available_formats.insert(
        "mp3".to_string(),
        FormatInfo {
            qualities: mp3_qualities.clone(),
            default_quality: mp3_qualities
                .first()
                .cloned()
                .unwrap_or_else(|| "320k".to_string()),
        },
    );
    if !mp4_qualities.is_empty() {
        available_formats.insert(
            "mp4".to_string(),
            FormatInfo {
                default_quality: mp4_qualities
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "720p".to_string()),
                qualities: mp4_qualities.clone(),
            },
        );
    }

    let mut estimated_sizes = BTreeMap::new();
    estimated_sizes.insert("mp3".to_string(), estimate_mp3_sizes(duration));
    if !mp4_qualities.is_empty() {
        estimated_sizes.insert(
            "mp4".to_string(),
            estimate_mp4_sizes(&info, &mp4_qualities, duration),
        );
    }

    Ok(InspectResponse {
        id,
        source,
        title,
        duration,
        thumbnail_url,
        channel,
        webpage_url,
        available_formats,
        estimated_sizes,
        frame_rates,
    })
}

fn estimate_mp3_sizes(duration: u64) -> BTreeMap<String, u64> {
    let mut sizes = BTreeMap::new();
    for bitrate in [320_u64, 192_u64, 128_u64] {
        let bytes = duration.saturating_mul(bitrate * 1000 / 8);
        sizes.insert(format!("{}k", bitrate), bytes);
    }
    sizes
}

fn extract_thumbnail_url(info: &Value) -> String {
    for candidate in [
        "thumbnail",
        "thumbnail_url",
        "display_url",
        "display_image",
        "og_image",
        "cover",
        "cover_url",
        "dynamic_cover",
        "dynamic_cover_url",
        "origin_cover",
        "origin_cover_url",
    ] {
        if let Some(url) = info.get(candidate).and_then(Value::as_str) {
            if is_remote_http_url(url) {
                return url.to_string();
            }
        }
    }

    if let Some(thumbnails) = info.get("thumbnails").and_then(Value::as_array) {
        for thumbnail in thumbnails.iter().rev() {
            for field in ["url", "src", "image_url", "imageUrl"] {
                if let Some(url) = thumbnail.get(field).and_then(Value::as_str) {
                    if is_remote_http_url(url) {
                        return url.to_string();
                    }
                }
            }
        }
    }

    if let Some(url) = find_thumbnail_url_in_value(info, None) {
        return url;
    }

    String::new()
}

fn find_thumbnail_url_in_value(value: &Value, parent_key: Option<&str>) -> Option<String> {
    match value {
        Value::Object(map) => {
            for (key, nested_value) in map {
                let lower_key = key.to_ascii_lowercase();
                if lower_key.contains("avatar") || lower_key.contains("profile") {
                    continue;
                }

                if let Some(url) = find_thumbnail_url_in_value(nested_value, Some(&lower_key)) {
                    return Some(url);
                }
            }
            None
        }
        Value::Array(items) => items
            .iter()
            .find_map(|item| find_thumbnail_url_in_value(item, parent_key)),
        Value::String(text) => {
            let key = parent_key.unwrap_or_default();
            let looks_like_thumbnail_field = key.contains("thumb")
                || key.contains("cover")
                || key.contains("image")
                || key.contains("display");

            if looks_like_thumbnail_field && is_remote_http_url(text) {
                Some(text.to_string())
            } else {
                None
            }
        }
        _ => None,
    }
}

fn is_remote_http_url(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };

    matches!(parsed.scheme(), "http" | "https") && parsed.host_str().is_some()
}

fn parse_duration_seconds(info: &Value) -> u64 {
    if let Some(seconds) = info.get("duration").and_then(Value::as_u64) {
        return seconds;
    }

    if let Some(seconds) = info
        .get("duration")
        .and_then(Value::as_f64)
        .map(|value| value.round() as u64)
    {
        return seconds;
    }

    if let Some(seconds) = info
        .get("duration")
        .and_then(Value::as_str)
        .and_then(parse_duration_string)
    {
        return seconds;
    }

    if let Some(seconds) = info
        .get("duration_string")
        .and_then(Value::as_str)
        .and_then(parse_duration_string)
    {
        return seconds;
    }

    0
}

fn parse_duration_string(input: &str) -> Option<u64> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(seconds) = trimmed.parse::<f64>() {
        return Some(seconds.round() as u64);
    }

    let mut total = 0_u64;
    let mut saw_segment = false;

    for segment in trimmed.split(':') {
        let value = segment.trim().parse::<u64>().ok()?;
        total = total.saturating_mul(60).saturating_add(value);
        saw_segment = true;
    }

    if saw_segment { Some(total) } else { None }
}

fn estimate_mp4_sizes(info: &Value, qualities: &[String], duration: u64) -> BTreeMap<String, u64> {
    let mut sizes = BTreeMap::new();
    if duration == 0 {
        return sizes;
    }

    let duration_seconds = duration as f64;
    let formats = info
        .get("formats")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let best_audio_bitrate = formats
        .iter()
        .filter_map(estimate_audio_bitrate_kbps)
        .fold(0.0_f64, f64::max);

    for quality in qualities {
        let height = quality.trim_end_matches('p').parse::<u64>().ok();
        if let Some(height) = height {
            if let Some(size) = formats
                .iter()
                .filter(|format| {
                    format_supports_mp4_estimate(format)
                        && format.get("height").and_then(Value::as_u64) == Some(height)
                })
                .filter_map(|format| {
                    estimate_format_size_bytes(format, duration_seconds, best_audio_bitrate)
                })
                .max()
            {
                sizes.insert(quality.clone(), size);
            }
        }
    }
    sizes
}

fn format_supports_mp4_estimate(format: &Value) -> bool {
    matches!(
        format
            .get("ext")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        "mp4" | "webm" | "m4a"
    )
}

fn estimate_format_size_bytes(
    format: &Value,
    duration_seconds: f64,
    best_audio_bitrate_kbps: f64,
) -> Option<u64> {
    explicit_format_size_bytes(format).or_else(|| {
        let total_bitrate_kbps = estimate_total_bitrate_kbps(format, best_audio_bitrate_kbps)?;
        if total_bitrate_kbps <= 0.0 {
            return None;
        }

        Some(((duration_seconds * total_bitrate_kbps * 1000.0) / 8.0).round() as u64)
    })
}

fn explicit_format_size_bytes(format: &Value) -> Option<u64> {
    numeric_value(format.get("filesize")).or_else(|| numeric_value(format.get("filesize_approx")))
}

fn estimate_audio_bitrate_kbps(format: &Value) -> Option<f64> {
    let acodec = format
        .get("acodec")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let vcodec = format
        .get("vcodec")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if acodec == "none" {
        return None;
    }

    if vcodec == "none" || format.get("height").and_then(Value::as_u64).is_none() {
        return numeric_value_f64(format.get("abr"))
            .or_else(|| numeric_value_f64(format.get("tbr")));
    }

    None
}

fn estimate_total_bitrate_kbps(format: &Value, best_audio_bitrate_kbps: f64) -> Option<f64> {
    if let Some(total_bitrate) = numeric_value_f64(format.get("tbr")) {
        return Some(total_bitrate);
    }

    let video_bitrate = numeric_value_f64(format.get("vbr"));
    let audio_bitrate = numeric_value_f64(format.get("abr"));
    let vcodec = format
        .get("vcodec")
        .and_then(Value::as_str)
        .unwrap_or_default();

    match (video_bitrate, audio_bitrate) {
        (Some(video), Some(audio)) => Some(video + audio),
        (Some(video), None) if vcodec != "none" && best_audio_bitrate_kbps > 0.0 => {
            Some(video + best_audio_bitrate_kbps)
        }
        (None, Some(audio)) => Some(audio),
        _ => None,
    }
}

fn numeric_value(value: Option<&Value>) -> Option<u64> {
    if let Some(number) = value.and_then(Value::as_u64) {
        return Some(number);
    }

    numeric_value_f64(value).map(|number| number.round() as u64)
}

fn numeric_value_f64(value: Option<&Value>) -> Option<f64> {
    let value = value?;
    value
        .as_f64()
        .or_else(|| value.as_u64().map(|number| number as f64))
        .or_else(|| value.as_i64().map(|number| number as f64))
        .or_else(|| {
            value
                .as_str()
                .and_then(|text| text.trim().parse::<f64>().ok())
        })
}

fn collect_mp4_qualities(info: &Value) -> Vec<String> {
    let formats = info
        .get("formats")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut heights: Vec<u64> = formats
        .iter()
        .filter_map(|format| {
            let ext = format
                .get("ext")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let height = format.get("height").and_then(Value::as_u64)?;
            if ext == "mp4" || ext == "webm" || ext == "m4a" {
                Some(height)
            } else {
                None
            }
        })
        .collect();
    heights.sort_unstable();
    heights.dedup();
    heights.reverse();
    if heights.is_empty() {
        return Vec::new();
    }
    heights
        .into_iter()
        .map(|height| format!("{}p", height))
        .collect()
}

fn collect_mp4_frame_rates(info: &Value, qualities: &[String]) -> BTreeMap<String, f64> {
    let formats = info
        .get("formats")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut frame_rates = BTreeMap::new();

    for quality in qualities {
        let Some(height) = quality.trim_end_matches('p').parse::<u64>().ok() else {
            continue;
        };

        let fps = formats
            .iter()
            .filter_map(|format| {
                let ext = format
                    .get("ext")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let vcodec = format
                    .get("vcodec")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let fmt_height = format.get("height").and_then(Value::as_u64)?;

                if fmt_height != height || vcodec == "none" || !(ext == "mp4" || ext == "webm") {
                    return None;
                }

                parse_fps_value(format.get("fps")?)
            })
            .fold(None, |current: Option<f64>, value| {
                Some(current.map_or(value, |existing| existing.max(value)))
            });

        if let Some(fps) = fps {
            frame_rates.insert(quality.clone(), fps);
        }
    }

    frame_rates
}

fn parse_fps_value(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64().filter(|fps| *fps > 0.0),
        Value::String(text) => text.trim().parse::<f64>().ok().filter(|fps| *fps > 0.0),
        _ => None,
    }
}

async fn fetch_media_info(
    url: &str,
    cookies_from_browser: Option<&str>,
) -> Result<Value, ApiError> {
    let mut command = Command::new("yt-dlp");
    command
        .arg("--dump-single-json")
        .arg("--no-playlist")
        .arg("--skip-download")
        .arg(url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(browser) = cookies_from_browser {
        command.arg("--cookies-from-browser").arg(browser);
    }

    let output = command.output().await.map_err(|_| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "Failed to start yt-dlp. Install yt-dlp locally and make sure it is on PATH.",
        )
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let source_label = source_display_name(url);
        let code = if stderr.contains("not a bot") {
            "UNSUPPORTED_VIDEO"
        } else {
            "CONVERSION_FAILED"
        };
        let message = if code == "UNSUPPORTED_VIDEO" {
            format!("{} blocked access to this media.", source_label)
        } else {
            format!(
                "The requested {} media could not be processed.",
                source_label.to_lowercase()
            )
        };
        return Err(
            ApiError::new(StatusCode::BAD_REQUEST, code, message).with_detail("reason", stderr)
        );
    }

    serde_json::from_slice::<Value>(&output.stdout).map_err(|_| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "UNSUPPORTED_VIDEO",
            "yt-dlp returned malformed metadata for this URL.",
        )
    })
}

fn sanitize_supported_url(input: &str) -> Result<String, ApiError> {
    let parsed = url::Url::parse(input)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "INVALID_URL", "That URL doesn’t look right. Please paste a valid YouTube, SoundCloud, Instagram, or TikTok link."))?;

    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    if is_youtube_host(&host) {
        return normalize_youtube_url(&parsed);
    }

    if is_soundcloud_host(&host) {
        if parsed.path().trim_matches('/').is_empty() {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "INVALID_URL",
                "That SoundCloud URL doesn’t point to a track or page.",
            ));
        }

        let mut normalized = parsed;
        normalized.set_fragment(None);
        return Ok(normalized.to_string());
    }

    if is_instagram_host(&host) {
        if parsed.path().trim_matches('/').is_empty() {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "INVALID_URL",
                "That Instagram URL doesn’t point to a reel or post.",
            ));
        }

        let mut normalized = parsed;
        normalized.set_fragment(None);
        return Ok(normalized.to_string());
    }

    if is_tiktok_host(&host) {
        if parsed.path().trim_matches('/').is_empty() {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "INVALID_URL",
                "That TikTok URL doesn’t point to a video.",
            ));
        }

        let mut normalized = parsed;
        normalized.set_fragment(None);
        return Ok(normalized.to_string());
    }

    Err(ApiError::new(
        StatusCode::BAD_REQUEST,
        "UNSUPPORTED_SOURCE",
        "Only YouTube, SoundCloud, Instagram, and TikTok URLs are supported in local mode.",
    ))
}

fn normalize_youtube_url(parsed: &url::Url) -> Result<String, ApiError> {
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    let video_id = if host == "youtu.be" {
        parsed.path().trim_matches('/').to_string()
    } else {
        parsed
            .query_pairs()
            .find(|(key, _)| key == "v")
            .map(|(_, value)| value.to_string())
            .unwrap_or_default()
    };

    if video_id.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "INVALID_URL",
            "That URL doesn’t include a YouTube video id.",
        ));
    }

    Ok(format!("https://www.youtube.com/watch?v={video_id}"))
}

fn is_youtube_host(host: &str) -> bool {
    matches!(
        host,
        "youtube.com" | "www.youtube.com" | "m.youtube.com" | "youtu.be"
    )
}

fn is_host_or_subdomain(host: &str, root: &str) -> bool {
    host == root || host.ends_with(&format!(".{root}"))
}

fn is_supported_thumbnail_host(host: &str) -> bool {
    is_youtube_host(host)
        || is_soundcloud_host(host)
        || is_instagram_host(host)
        || is_tiktok_host(host)
        || is_host_or_subdomain(host, "ytimg.com")
        || is_host_or_subdomain(host, "ggpht.com")
        || is_host_or_subdomain(host, "sndcdn.com")
        || is_host_or_subdomain(host, "scdn.co")
        || is_host_or_subdomain(host, "cdninstagram.com")
        || is_host_or_subdomain(host, "fbcdn.net")
        || is_host_or_subdomain(host, "fbcdn.com")
        || is_host_or_subdomain(host, "fbsbx.com")
        || is_host_or_subdomain(host, "tiktokcdn.com")
        || is_host_or_subdomain(host, "byteimg.com")
        || is_host_or_subdomain(host, "ibyteimg.com")
        || is_host_or_subdomain(host, "muscdn.com")
}

fn is_supported_remote_thumbnail_url(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };

    if !matches!(parsed.scheme(), "http" | "https") {
        return false;
    }

    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    !host.is_empty() && is_supported_thumbnail_host(&host)
}

fn is_supported_page_url(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };

    if !matches!(parsed.scheme(), "http" | "https") {
        return false;
    }

    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    !host.is_empty()
        && (is_instagram_host(&host)
            || is_tiktok_host(&host)
            || is_youtube_host(&host)
            || is_soundcloud_host(&host))
}

fn default_referer_for_thumbnail_url(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let host = parsed.host_str()?.to_ascii_lowercase();

    if is_instagram_host(&host)
        || is_host_or_subdomain(&host, "cdninstagram.com")
        || is_host_or_subdomain(&host, "fbcdn.net")
        || is_host_or_subdomain(&host, "fbcdn.com")
        || is_host_or_subdomain(&host, "fbsbx.com")
    {
        return Some("https://www.instagram.com/".to_string());
    }

    if is_tiktok_host(&host)
        || is_host_or_subdomain(&host, "tiktokcdn.com")
        || is_host_or_subdomain(&host, "byteimg.com")
        || is_host_or_subdomain(&host, "ibyteimg.com")
        || is_host_or_subdomain(&host, "muscdn.com")
    {
        return Some("https://www.tiktok.com/".to_string());
    }

    if is_youtube_host(&host) || is_host_or_subdomain(&host, "ytimg.com") {
        return Some("https://www.youtube.com/".to_string());
    }

    if is_soundcloud_host(&host)
        || is_host_or_subdomain(&host, "sndcdn.com")
        || is_host_or_subdomain(&host, "scdn.co")
    {
        return Some("https://soundcloud.com/".to_string());
    }

    None
}

fn is_soundcloud_host(host: &str) -> bool {
    matches!(
        host,
        "soundcloud.com"
            | "www.soundcloud.com"
            | "m.soundcloud.com"
            | "on.soundcloud.com"
            | "snd.sc"
    )
}

fn is_instagram_host(host: &str) -> bool {
    matches!(
        host,
        "instagram.com" | "www.instagram.com" | "m.instagram.com"
    )
}

fn is_tiktok_host(host: &str) -> bool {
    matches!(
        host,
        "tiktok.com" | "www.tiktok.com" | "m.tiktok.com" | "vm.tiktok.com" | "vt.tiktok.com"
    )
}

fn detect_source_from_info(info: &Value) -> String {
    if let Some(webpage_url) = info.get("webpage_url").and_then(Value::as_str) {
        if let Ok(parsed) = url::Url::parse(webpage_url) {
            let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
            if is_soundcloud_host(&host) {
                return "soundcloud".to_string();
            }
            if is_youtube_host(&host) {
                return "youtube".to_string();
            }
            if is_instagram_host(&host) {
                return "instagram".to_string();
            }
            if is_tiktok_host(&host) {
                return "tiktok".to_string();
            }
        }
    }

    if let Some(extractor) = info.get("extractor_key").and_then(Value::as_str) {
        let normalized = extractor.to_ascii_lowercase();
        if normalized.contains("soundcloud") {
            return "soundcloud".to_string();
        }
        if normalized.contains("youtube") {
            return "youtube".to_string();
        }
        if normalized.contains("instagram") {
            return "instagram".to_string();
        }
        if normalized.contains("tiktok") {
            return "tiktok".to_string();
        }
    }

    "unknown".to_string()
}

fn source_display_name(url: &str) -> &'static str {
    if let Ok(parsed) = url::Url::parse(url) {
        let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
        if is_soundcloud_host(&host) {
            return "SoundCloud";
        }
        if is_youtube_host(&host) {
            return "YouTube";
        }
        if is_instagram_host(&host) {
            return "Instagram";
        }
        if is_tiktok_host(&host) {
            return "TikTok";
        }
    }

    "Source"
}

async fn find_download_file(job_dir: &Path) -> Option<PathBuf> {
    let mut dir = fs::read_dir(job_dir).await.ok()?;
    while let Ok(Some(entry)) = dir.next_entry().await {
        let path = entry.path();
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

async fn normalize_mp4_for_playback(file_path: &Path) -> Result<PathBuf, String> {
    let file_name = file_path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("output");
    let temp_path = file_path.with_file_name(format!("{file_name}.compat.mp4"));

    let primary_args = [
        "-y".to_string(),
        "-i".to_string(),
        file_path.to_string_lossy().to_string(),
        "-c:v".to_string(),
        "copy".to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        "192k".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        temp_path.to_string_lossy().to_string(),
    ];

    match run_ffmpeg(&primary_args).await {
        Ok(()) => {
            install_normalized_mp4(file_path, &temp_path).await?;
            Ok(file_path.to_path_buf())
        }
        Err(primary_error) => {
            let _ = fs::remove_file(&temp_path).await;
            let fallback_args = [
                "-y".to_string(),
                "-i".to_string(),
                file_path.to_string_lossy().to_string(),
                "-c:v".to_string(),
                "libx264".to_string(),
                "-preset".to_string(),
                "fast".to_string(),
                "-crf".to_string(),
                "22".to_string(),
                "-c:a".to_string(),
                "aac".to_string(),
                "-b:a".to_string(),
                "192k".to_string(),
                "-movflags".to_string(),
                "+faststart".to_string(),
                temp_path.to_string_lossy().to_string(),
            ];

            run_ffmpeg(&fallback_args).await.map_err(|fallback_error| {
                format!("{primary_error}; fallback transcode also failed: {fallback_error}")
            })?;
            install_normalized_mp4(file_path, &temp_path).await?;
            Ok(file_path.to_path_buf())
        }
    }
}

async fn run_ffmpeg(args: &[String]) -> Result<(), String> {
    let output = Command::new("ffmpeg")
        .args(args)
        .output()
        .await
        .map_err(|error| format!("failed to start ffmpeg: {error}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!(
            "ffmpeg exited with status {}",
            output.status.code().unwrap_or(-1)
        )
    };

    Err(detail)
}

async fn install_normalized_mp4(
    original_path: &Path,
    normalized_path: &Path,
) -> Result<(), String> {
    fs::copy(normalized_path, original_path)
        .await
        .map_err(|error| format!("failed to replace the MP4 file: {error}"))?;
    fs::remove_file(normalized_path)
        .await
        .map_err(|error| format!("failed to clean up the temporary MP4 file: {error}"))?;
    Ok(())
}

fn parse_percent(line: &str) -> Option<f32> {
    let marker = "%";
    let idx = line.find(marker)?;
    let start = line[..idx]
        .rfind(|ch: char| !(ch.is_ascii_digit() || ch == '.'))
        .map(|position| position + 1)
        .unwrap_or(0);
    line[start..idx].trim().parse::<f32>().ok()
}

async fn verify_binary(binary: &str, version_arg: &str) {
    let result = Command::new(binary).arg(version_arg).output().await;
    match result {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            info!(binary, version, "binary available");
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            warn!(binary, stderr, "binary exists but --version failed");
        }
        Err(error) => {
            warn!(binary, %error, "binary not found in PATH");
        }
    }
}

fn init_logging() {
    let filter = env::var("RUST_LOG")
        .unwrap_or_else(|_| "palethea_native_backend=info,tower_http=warn".to_string());
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .compact()
        .init();
}
