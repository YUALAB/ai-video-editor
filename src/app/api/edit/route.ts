import { NextRequest, NextResponse } from 'next/server'
import { VideoEditRequestSchema } from '@/schemas/video'
import { sanitizePrompt, isValidVideoMimeType, isValidFileSize } from '@/lib/sanitize'

const BACKEND_URL = process.env.BACKEND_URL || ''

export async function POST(request: NextRequest) {
  try {
    // Check content type
    const contentType = request.headers.get('content-type')
    if (!contentType?.includes('multipart/form-data')) {
      return NextResponse.json(
        { error: 'Invalid content type. Expected multipart/form-data.' },
        { status: 400 }
      )
    }

    const formData = await request.formData()

    const prompt = formData.get('prompt')
    const format = formData.get('format')
    const video = formData.get('video')

    // Validate and sanitize prompt
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      )
    }

    const sanitizedPrompt = sanitizePrompt(prompt)

    // Validate input schema
    const validationResult = VideoEditRequestSchema.safeParse({
      prompt: sanitizedPrompt,
      format: typeof format === 'string' ? format : 'tiktok',
      hasVideo: video !== null,
    })

    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validationResult.error.issues },
        { status: 400 }
      )
    }

    // Validate video file
    if (video && video instanceof File) {
      // Check MIME type
      if (!isValidVideoMimeType(video.type)) {
        return NextResponse.json(
          { error: 'Invalid video format. Supported formats: MP4, WebM, MOV, AVI, MKV.' },
          { status: 400 }
        )
      }

      // Check file size
      if (!isValidFileSize(video.size)) {
        return NextResponse.json(
          { error: 'Video file too large. Maximum size is 500MB.' },
          { status: 400 }
        )
      }
    } else {
      return NextResponse.json(
        { error: 'Video file is required' },
        { status: 400 }
      )
    }

    // If backend URL is configured, forward to backend
    if (BACKEND_URL) {
      const backendFormData = new FormData()
      backendFormData.append('prompt', sanitizedPrompt)
      backendFormData.append('format', validationResult.data.format)
      backendFormData.append('video', video)

      const backendResponse = await fetch(`${BACKEND_URL}/api/edit`, {
        method: 'POST',
        body: backendFormData,
      })

      if (!backendResponse.ok) {
        const errorData = await backendResponse.json().catch(() => ({}))
        return NextResponse.json(
          { error: 'Backend processing failed', details: errorData },
          { status: backendResponse.status }
        )
      }

      const data = await backendResponse.json()
      return NextResponse.json(data)
    }

    // Generate job ID for local/mock processing
    const jobId = crypto.randomUUID()

    return NextResponse.json({
      id: jobId,
      status: 'pending',
      message: '処理を開始しました',
      createdAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error processing request:', error)

    // Don't expose internal errors to client
    return NextResponse.json(
      { error: 'An error occurred while processing your request' },
      { status: 500 }
    )
  }
}

// Health check for the API route
export async function GET() {
  return NextResponse.json({ status: 'healthy' })
}
