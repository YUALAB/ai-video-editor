'use client'

import type { VideoEffects } from './ffmpeg'

export interface ProjectAction {
  type: 'addClip' | 'removeClip' | 'reorderTimeline' | 'clearTimeline' | 'setGlobalEffects' | 'trimClip' | 'splitClip' | 'replaceTimeline' | 'setSubtitleStyle'
  videoIndex?: number
  startTime?: number
  endTime?: number
  clipIndex?: number
  newOrder?: number[]
  effects?: Partial<VideoEffects>
  transition?: 'none' | 'fade' | 'crossfade'
  // For trimClip
  newStartTime?: number
  newEndTime?: number
  // For splitClip
  splitAt?: number
  // For replaceTimeline (auto-edit result)
  clips?: Array<{
    videoIndex: number
    startTime: number
    endTime: number
    transition?: 'none' | 'fade' | 'crossfade'
  }>
  // For setSubtitleStyle
  subtitleStyle?: {
    fontSize?: 'small' | 'medium' | 'large'
    position?: 'top' | 'center' | 'bottom'
    color?: string
    backgroundColor?: string
  }
}

export interface ProjectContext {
  videoCount: number
  videos: Array<{
    index: number
    name: string
    duration: string
  }>
  timelineClipCount: number
  timeline: Array<{
    position: number
    videoIndex: number
    startTime?: number
    endTime?: number
    transition?: string
  }>
  globalEffects: VideoEffects
}

export interface AIEditResponse {
  message: string
  effects?: Partial<VideoEffects>
  projectAction?: ProjectAction
  understood: boolean
}

// Extract frames from video for AI vision
export async function extractVideoFrames(
  videoUrl: string,
  numFrames: number = 3
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.src = videoUrl

    video.onloadedmetadata = async () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas context not available'))
        return
      }

      const maxSize = 512
      const scale = Math.min(maxSize / video.videoWidth, maxSize / video.videoHeight, 1)
      canvas.width = video.videoWidth * scale
      canvas.height = video.videoHeight * scale

      const duration = video.duration
      const frames: string[] = []

      const timestamps = Array.from({ length: numFrames }, (_, i) =>
        (duration * (i + 1)) / (numFrames + 1)
      )

      for (const time of timestamps) {
        video.currentTime = time
        await new Promise<void>((res) => {
          video.onseeked = () => res()
        })

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
        const base64 = dataUrl.split(',')[1]
        frames.push(base64)
      }

      resolve(frames)
    }

    video.onerror = () => reject(new Error('Failed to load video'))
  })
}

// Extract frames with timestamps for scene analysis
export interface FrameWithTimestamp {
  timestamp: number
  base64: string
}

export async function extractFramesForSceneAnalysis(
  videoUrl: string,
  intervalSeconds: number = 2
): Promise<{ frames: FrameWithTimestamp[], duration: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.src = videoUrl

    video.onloadedmetadata = async () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas context not available'))
        return
      }

      // Smaller size for scene analysis to reduce token usage
      const maxSize = 256
      const scale = Math.min(maxSize / video.videoWidth, maxSize / video.videoHeight, 1)
      canvas.width = video.videoWidth * scale
      canvas.height = video.videoHeight * scale

      const duration = video.duration
      const frames: FrameWithTimestamp[] = []

      // Extract frames at regular intervals, max 15 frames to avoid token limits
      const numFrames = Math.min(Math.ceil(duration / intervalSeconds), 15)
      const actualInterval = duration / numFrames

      for (let i = 0; i < numFrames; i++) {
        const time = i * actualInterval + actualInterval / 2
        video.currentTime = time
        await new Promise<void>((res) => {
          video.onseeked = () => res()
        })

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.5)
        const base64 = dataUrl.split(',')[1]
        frames.push({ timestamp: time, base64 })
      }

      resolve({ frames, duration })
    }

    video.onerror = () => reject(new Error('Failed to load video'))
  })
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function callAI(
  prompt: string,
  apiKey: string,
  images?: string[],
  projectContext?: ProjectContext,
  conversationHistory?: ConversationMessage[]
): Promise<AIEditResponse> {
  try {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        apiKey,
        images,
        projectContext,
        conversationHistory,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error('AI API error:', errorData)
      throw new Error(errorData.error || `API error: ${response.status}`)
    }

    const data = await response.json()
    return {
      message: data.message || '編集を適用しました',
      effects: data.effects,
      projectAction: data.projectAction,
      understood: data.understood !== false,
    }
  } catch (error) {
    console.error('AI call failed:', error)
    throw error
  }
}
