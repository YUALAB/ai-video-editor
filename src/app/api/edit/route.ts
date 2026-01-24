import { NextRequest, NextResponse } from 'next/server'
import { VideoEditRequestSchema } from '@/schemas/video'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()

    const prompt = formData.get('prompt') as string
    const format = formData.get('format') as string
    const video = formData.get('video') as File | null

    // Validate input
    const validationResult = VideoEditRequestSchema.safeParse({
      prompt,
      format,
      videoFile: video,
    })

    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validationResult.error.errors },
        { status: 400 }
      )
    }

    // TODO: Send to Railway backend for processing
    // For now, return a mock response
    const jobId = crypto.randomUUID()

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
