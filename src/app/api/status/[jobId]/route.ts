import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const BACKEND_URL = process.env.BACKEND_URL || ''

// UUID validation schema
const JobIdSchema = z.string().uuid()

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params

    // Validate job ID format
    const validationResult = JobIdSchema.safeParse(jobId)
    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Invalid job ID format' },
        { status: 400 }
      )
    }

    // If backend URL is configured, forward to backend
    if (BACKEND_URL) {
      const backendResponse = await fetch(`${BACKEND_URL}/api/status/${jobId}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      })

      if (!backendResponse.ok) {
        if (backendResponse.status === 404) {
          return NextResponse.json(
            { error: 'Job not found' },
            { status: 404 }
          )
        }
        return NextResponse.json(
          { error: 'Failed to fetch job status' },
          { status: backendResponse.status }
        )
      }

      const data = await backendResponse.json()
      return NextResponse.json(data)
    }

    // Mock response for development
    return NextResponse.json({
      id: jobId,
      status: 'pending',
      progress: 0,
      output_url: null,
      error: null,
    })
  } catch (error) {
    console.error('Error fetching job status:', error)
    return NextResponse.json(
      { error: 'An error occurred while fetching job status' },
      { status: 500 }
    )
  }
}
