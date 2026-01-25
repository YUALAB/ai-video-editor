'use client'

import { FFmpeg } from '@ffmpeg/ffmpeg'

export interface ProcessingProgress {
  progress: number
  message: string
}

export interface VideoFormat {
  width: number
  height: number
  name: string
}

export interface VideoEffects {
  brightness?: number
  contrast?: number
  saturation?: number
  speed?: number
  mute?: boolean
  flip?: boolean
  rotate?: number
}

export const VIDEO_FORMATS: Record<string, VideoFormat> = {
  tiktok: { width: 1080, height: 1920, name: 'TikTok' },
  youtube: { width: 1920, height: 1080, name: 'YouTube' },
  square: { width: 1080, height: 1080, name: 'Square' },
  landscape: { width: 1920, height: 1080, name: 'Landscape' },
}

// FFmpeg instance
let ffmpegInstance: FFmpeg | null = null
let ffmpegLoaded = false

// CDN URL for core files
const CORE_VERSION = '0.12.6'
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`

async function fetchAsBlob(url: string, type: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}`)
  }
  const blob = await response.blob()
  return URL.createObjectURL(new Blob([blob], { type }))
}

export async function loadFFmpeg(
  onProgress?: (progress: ProcessingProgress) => void
): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegLoaded) {
    return ffmpegInstance
  }

  onProgress?.({ progress: 0, message: 'FFmpegを読み込み中...' })

  try {
    ffmpegInstance = new FFmpeg()

    ffmpegInstance.on('log', ({ message }) => {
      console.log('[FFmpeg]', message)
    })

    ffmpegInstance.on('progress', ({ progress }) => {
      const percent = Math.round(progress * 100)
      onProgress?.({
        progress: Math.min(Math.max(percent, 0), 99),
        message: `処理中... ${percent}%`,
      })
    })

    onProgress?.({ progress: 5, message: 'FFmpegコアを読み込み中...' })

    const [coreURL, wasmURL] = await Promise.all([
      fetchAsBlob(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
      fetchAsBlob(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
    ])

    onProgress?.({ progress: 8, message: 'FFmpegを初期化中...' })

    await ffmpegInstance.load({
      coreURL,
      wasmURL,
    })

    ffmpegLoaded = true
    onProgress?.({ progress: 10, message: 'FFmpeg準備完了' })

    return ffmpegInstance
  } catch (error) {
    console.error('Failed to load FFmpeg:', error)
    throw new Error('FFmpegの読み込みに失敗しました。ページを再読み込みしてください。')
  }
}

export async function processVideo(
  inputFile: File,
  format: string,
  onProgress?: (progress: ProcessingProgress) => void,
  trimStart?: number,
  trimEnd?: number,
  effects?: VideoEffects
): Promise<Blob> {
  const ff = await loadFFmpeg(onProgress)
  const formatConfig = VIDEO_FORMATS[format] || VIDEO_FORMATS.tiktok

  onProgress?.({ progress: 15, message: '動画を読み込み中...' })

  const arrayBuffer = await inputFile.arrayBuffer()
  const inputData = new Uint8Array(arrayBuffer)

  await ff.writeFile('input.mp4', inputData)

  onProgress?.({ progress: 25, message: '動画を処理中...' })

  // Build video filters
  const videoFilters: string[] = []

  // Scale and pad for format
  videoFilters.push(
    `scale=${formatConfig.width}:${formatConfig.height}:force_original_aspect_ratio=decrease`,
    `pad=${formatConfig.width}:${formatConfig.height}:(ow-iw)/2:(oh-ih)/2:black`
  )

  // Apply effects
  if (effects) {
    // Brightness and contrast (eq filter)
    if (effects.brightness !== undefined || effects.contrast !== undefined) {
      const brightness = effects.brightness || 0
      const contrast = effects.contrast || 1
      videoFilters.push(`eq=brightness=${brightness}:contrast=${contrast}`)
    }

    // Saturation
    if (effects.saturation !== undefined) {
      videoFilters.push(`eq=saturation=${effects.saturation}`)
    }

    // Flip (horizontal mirror)
    if (effects.flip) {
      videoFilters.push('hflip')
    }

    // Rotate
    if (effects.rotate) {
      const rotations = Math.floor(effects.rotate / 90)
      for (let i = 0; i < rotations; i++) {
        videoFilters.push('transpose=1')
      }
    }
  }

  const filterComplex = videoFilters.join(',')

  // Build ffmpeg command
  const ffmpegArgs: string[] = []

  // Trim start
  if (trimStart !== undefined && trimStart > 0) {
    ffmpegArgs.push('-ss', trimStart.toFixed(3))
  }

  ffmpegArgs.push('-i', 'input.mp4')

  // Trim duration
  if (trimEnd !== undefined && trimStart !== undefined && trimEnd > trimStart) {
    const duration = trimEnd - trimStart
    ffmpegArgs.push('-t', duration.toFixed(3))
  }

  // Video filters
  ffmpegArgs.push('-vf', filterComplex)

  // Speed adjustment (needs special handling)
  if (effects?.speed && effects.speed !== 1) {
    const speed = effects.speed
    // Video speed
    ffmpegArgs.push('-filter:v', `setpts=${1/speed}*PTS`)
    // Audio speed (if not muted)
    if (!effects.mute) {
      ffmpegArgs.push('-filter:a', `atempo=${speed}`)
    }
  }

  // Video codec
  ffmpegArgs.push(
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '28'
  )

  // Audio handling
  if (effects?.mute) {
    ffmpegArgs.push('-an')
  } else {
    ffmpegArgs.push('-c:a', 'aac', '-b:a', '128k')
  }

  ffmpegArgs.push(
    '-movflags', '+faststart',
    '-y',
    'output.mp4'
  )

  try {
    await ff.exec(ffmpegArgs)
  } catch (error) {
    console.error('FFmpeg exec error:', error)
    throw new Error('動画の処理中にエラーが発生しました')
  }

  onProgress?.({ progress: 90, message: '出力ファイルを準備中...' })

  const outputData = await ff.readFile('output.mp4')

  try {
    await ff.deleteFile('input.mp4')
    await ff.deleteFile('output.mp4')
  } catch {
    // Ignore cleanup errors
  }

  onProgress?.({ progress: 100, message: '完了!' })

  return new Blob([new Uint8Array(outputData as Uint8Array)], { type: 'video/mp4' })
}

export function isFFmpegSupported(): boolean {
  if (typeof window === 'undefined') return false
  return typeof SharedArrayBuffer !== 'undefined'
}
