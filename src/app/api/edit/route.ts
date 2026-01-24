import { NextRequest, NextResponse } from 'next/server'
import { VideoEditRequestSchema } from '@/schemas/video'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()

    const prompt = formData.get('prompt')
    const format = formData.get('format')
    const video = formData.get('video')

    // Validate input
    const validationResult = VideoEditRequestSchema.safeParse({
      prompt: typeof prompt === 'string' ? prompt : '',
      format: typeof format === 'string' ? format : 'tiktok',
      hasVideo: video !== null,
    })

    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validationResult.error.issues },
        { status: 400 }
      )
    }

    // Generate job ID
    const jobId = crypto.randomUUID()

    // TODO: Upload video to storage and send to Railway backend
    // For now, return a mock response
    return NextResponse.json({
      id: jobId,
      status: 'pending',
      message: '処理を開始しました',
      createdAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error processing request:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
