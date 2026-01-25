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

/**
 * Fetch a file and convert to blob URL
 */
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

    // Fetch core files and create blob URLs
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
  onProgress?: (progress: ProcessingProgress) => void
): Promise<Blob> {
  const ff = await loadFFmpeg(onProgress)
  const formatConfig = VIDEO_FORMATS[format] || VIDEO_FORMATS.tiktok

  onProgress?.({ progress: 15, message: '動画を読み込み中...' })

  // Convert file to Uint8Array
  const arrayBuffer = await inputFile.arrayBuffer()
  const inputData = new Uint8Array(arrayBuffer)

  // Write input file to FFmpeg virtual filesystem
  await ff.writeFile('input.mp4', inputData)

  onProgress?.({ progress: 25, message: '動画を処理中...' })

  // Process video: scale and pad to target format
  const filterComplex = [
    `scale=${formatConfig.width}:${formatConfig.height}:force_original_aspect_ratio=decrease`,
    `pad=${formatConfig.width}:${formatConfig.height}:(ow-iw)/2:(oh-ih)/2:black`,
  ].join(',')

  try {
    await ff.exec([
      '-i', 'input.mp4',
      '-vf', filterComplex,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '28',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-y',
      'output.mp4',
    ])
  } catch (error) {
    console.error('FFmpeg exec error:', error)
    throw new Error('動画の処理中にエラーが発生しました')
  }

  onProgress?.({ progress: 90, message: '出力ファイルを準備中...' })

  // Read output file
  const outputData = await ff.readFile('output.mp4')

  // Clean up
  try {
    await ff.deleteFile('input.mp4')
    await ff.deleteFile('output.mp4')
  } catch {
    // Ignore cleanup errors
  }

  onProgress?.({ progress: 100, message: '完了!' })

  // Convert to Blob
  return new Blob([new Uint8Array(outputData as Uint8Array)], { type: 'video/mp4' })
}

export function isFFmpegSupported(): boolean {
  if (typeof window === 'undefined') return false
  return typeof SharedArrayBuffer !== 'undefined'
}
