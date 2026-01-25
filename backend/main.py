import os
import re
import uuid
import asyncio
import secrets
from typing import Optional
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, field_validator
import httpx
import ffmpeg
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="AI Video Editor Backend")

# Allowed origins for CORS
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "https://ai-video-editor-virid.vercel.app",
]

frontend_url = os.getenv("FRONTEND_URL", "")
if frontend_url and frontend_url not in ALLOWED_ORIGINS:
    ALLOWED_ORIGINS.append(frontend_url)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    max_age=86400,
)

# Job status storage (in production, use Redis or database)
jobs: dict[str, dict] = {}

# Constants
MAX_FILE_SIZE = 500 * 1024 * 1024  # 500MB
ALLOWED_VIDEO_TYPES = {"video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/x-matroska"}
TEMP_DIR = Path("/tmp/video-editor")
TEMP_DIR.mkdir(exist_ok=True)


class VideoEditRequest(BaseModel):
    prompt: str
    format: str = "tiktok"
    video_url: Optional[str] = None

    @field_validator("prompt")
    @classmethod
    def sanitize_prompt(cls, v: str) -> str:
        # Remove potentially dangerous content
        v = re.sub(r'[<>]', '', v)
        v = re.sub(r'javascript:', '', v, flags=re.IGNORECASE)
        return v[:2000].strip()

    @field_validator("format")
    @classmethod
    def validate_format(cls, v: str) -> str:
        allowed_formats = {"tiktok", "youtube", "square", "landscape"}
        if v not in allowed_formats:
            return "tiktok"
        return v


class JobStatus(BaseModel):
    id: str
    status: str
    progress: int = 0
    output_url: Optional[str] = None
    error: Optional[str] = None


# Format configurations
FORMAT_CONFIGS = {
    "tiktok": {"width": 1080, "height": 1920, "aspect": "9:16"},
    "youtube": {"width": 1920, "height": 1080, "aspect": "16:9"},
    "square": {"width": 1080, "height": 1080, "aspect": "1:1"},
    "landscape": {"width": 1920, "height": 1080, "aspect": "16:9"},
}


def sanitize_filename(filename: str) -> str:
    """Sanitize filename to prevent path traversal attacks."""
    # Remove path components and keep only the filename
    filename = os.path.basename(filename)
    # Replace unsafe characters
    filename = re.sub(r'[^a-zA-Z0-9._-]', '_', filename)
    # Limit length
    return filename[:255]


def validate_video_file(file: UploadFile) -> None:
    """Validate uploaded video file."""
    if not file.content_type or file.content_type not in ALLOWED_VIDEO_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid video type. Allowed: {', '.join(ALLOWED_VIDEO_TYPES)}"
        )


async def call_qwen_api(prompt: str, video_path: Optional[str] = None) -> str:
    """Call Qwen3-VL API for video analysis and editing instructions."""
    ollama_api_key = os.getenv("OLLAMA_API_KEY")
    ollama_base_url = os.getenv("OLLAMA_BASE_URL", "https://ollama.com/api")

    if not ollama_api_key:
        raise ValueError("OLLAMA_API_KEY is not configured")

    system_prompt = """You are a video editing assistant. Based on the user's request,
generate FFmpeg commands or editing instructions.
Respond in JSON format with the following structure:
{
    "action": "cut|trim|text|filter|merge",
    "params": { ... },
    "ffmpeg_args": [ ... ]
}"""

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{ollama_base_url}/chat",
            headers={"Authorization": f"Bearer {ollama_api_key}"},
            json={
                "model": "qwen3-vl:235b-cloud",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                "stream": False,
            },
        )
        response.raise_for_status()
        data = response.json()
        return data.get("message", {}).get("content", "")


async def process_video(job_id: str, video_path: str, prompt: str, output_format: str):
    """Background task to process video."""
    output_path = TEMP_DIR / f"{job_id}_output.mp4"

    try:
        jobs[job_id]["status"] = "processing"
        jobs[job_id]["progress"] = 10

        # Get AI instructions
        try:
            ai_response = await call_qwen_api(prompt, video_path)
            jobs[job_id]["progress"] = 30
        except Exception as e:
            # Continue with basic processing if AI fails
            print(f"AI API error: {e}")
            jobs[job_id]["progress"] = 30

        # Get format config
        config = FORMAT_CONFIGS.get(output_format, FORMAT_CONFIGS["tiktok"])

        # Process video with FFmpeg
        jobs[job_id]["progress"] = 50

        # Basic processing - resize to target format with safe parameters
        try:
            stream = ffmpeg.input(video_path)
            stream = ffmpeg.filter(
                stream,
                "scale",
                config["width"],
                config["height"],
                force_original_aspect_ratio="decrease"
            )
            stream = ffmpeg.filter(
                stream,
                "pad",
                config["width"],
                config["height"],
                "(ow-iw)/2",
                "(oh-ih)/2"
            )
            stream = ffmpeg.output(
                stream,
                str(output_path),
                vcodec="libx264",
                acodec="aac",
                preset="medium",
                crf=23,
            )
            ffmpeg.run(stream, overwrite_output=True, quiet=True)
        except ffmpeg.Error as e:
            raise RuntimeError(f"FFmpeg processing failed: {e.stderr}")

        jobs[job_id]["progress"] = 90

        # Verify output file exists
        if not output_path.exists():
            raise RuntimeError("Output file was not created")

        jobs[job_id]["status"] = "completed"
        jobs[job_id]["progress"] = 100
        jobs[job_id]["output_url"] = f"/api/download/{job_id}"

    except Exception as e:
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = str(e)[:500]  # Limit error message length

    finally:
        # Clean up input file
        try:
            if os.path.exists(video_path):
                os.remove(video_path)
        except Exception:
            pass


async def cleanup_old_jobs():
    """Background task to clean up old job files."""
    import time
    current_time = time.time()
    for job_id, job in list(jobs.items()):
        # Clean up jobs older than 1 hour
        if job.get("created_at", 0) < current_time - 3600:
            output_path = TEMP_DIR / f"{job_id}_output.mp4"
            if output_path.exists():
                try:
                    output_path.unlink()
                except Exception:
                    pass
            del jobs[job_id]


@app.get("/")
async def root():
    return {"status": "healthy", "service": "AI Video Editor Backend"}


@app.post("/api/edit")
async def edit_video(
    background_tasks: BackgroundTasks,
    prompt: str = Form(..., max_length=2000),
    format: str = Form("tiktok"),
    video: Optional[UploadFile] = File(None),
):
    # Validate format
    if format not in FORMAT_CONFIGS:
        format = "tiktok"

    # Validate video
    if not video:
        raise HTTPException(status_code=400, detail="Video file is required")

    validate_video_file(video)

    # Generate secure job ID
    job_id = str(uuid.uuid4())

    # Save uploaded video with size limit check
    video_path = TEMP_DIR / f"{job_id}_input.mp4"

    total_size = 0
    try:
        with open(video_path, "wb") as f:
            while chunk := await video.read(8192):
                total_size += len(chunk)
                if total_size > MAX_FILE_SIZE:
                    os.remove(video_path)
                    raise HTTPException(
                        status_code=400,
                        detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB"
                    )
                f.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to save video file")

    # Sanitize prompt
    sanitized_prompt = re.sub(r'[<>]', '', prompt)[:2000].strip()

    # Initialize job
    import time
    jobs[job_id] = {
        "id": job_id,
        "status": "pending",
        "progress": 0,
        "output_url": None,
        "error": None,
        "created_at": time.time(),
    }

    # Start background processing
    background_tasks.add_task(process_video, job_id, str(video_path), sanitized_prompt, format)
    background_tasks.add_task(cleanup_old_jobs)

    return {"id": job_id, "status": "pending"}


@app.get("/api/status/{job_id}")
async def get_job_status(job_id: str):
    # Validate job_id format (UUID)
    try:
        uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID format")

    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = jobs[job_id]
    return {
        "id": job["id"],
        "status": job["status"],
        "progress": job["progress"],
        "output_url": job["output_url"],
        "error": job["error"],
    }


@app.get("/api/download/{job_id}")
async def download_video(job_id: str):
    # Validate job_id format
    try:
        uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID format")

    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = jobs[job_id]
    if job["status"] != "completed":
        raise HTTPException(status_code=400, detail="Video processing not complete")

    output_path = TEMP_DIR / f"{job_id}_output.mp4"
    if not output_path.exists():
        raise HTTPException(status_code=404, detail="Output file not found")

    return FileResponse(
        path=str(output_path),
        media_type="video/mp4",
        filename=f"edited_video_{job_id[:8]}.mp4",
    )


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
