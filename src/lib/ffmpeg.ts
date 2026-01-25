'use client'

import { FFmpeg } from '@ffmpeg/ffmpeg'

let ffmpeg: FFmpeg | null = null
let loaded = false

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

async function toBlobURL(url: string, mimeType: string): Promise<string> {
  const response = await fetch(url)
  const blob = await response.blob()
  return URL.createObjectURL(new Blob([blob], { type: mimeType }))
}

async function fetchFile(file: File): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer()
  return new Uint8Array(arrayBuffer)
}

export async function loadFFmpeg(
  onProgress?: (progress: ProcessingProgress) => void
): Promise<FFmpeg> {
  if (ffmpeg && loaded) {
    return ffmpeg
  }

  ffmpeg = new FFmpeg()

  ffmpeg.on('log', ({ message }) => {
    console.log('[FFmpeg]', message)
  })

  ffmpeg.on('progress', ({ progress }) => {
    const percent = Math.round(progress * 100)
    onProgress?.({
      progress: Math.min(Math.max(percent, 0), 99),
      message: `処理中... ${percent}%`,
    })
  })

  onProgress?.({ progress: 0, message: 'FFmpegを読み込み中...' })

  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'

  try {
    const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript')
    const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')

    await ffmpeg.load({
      coreURL,
      wasmURL,
    })

    loaded = true
    onProgress?.({ progress: 10, message: 'FFmpeg準備完了' })

    return ffmpeg
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

  // Write input file to FFmpeg virtual filesystem
  const inputData = await fetchFile(inputFile)
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

  // Convert FileData to Blob
  return new Blob([new Uint8Array(outputData as Uint8Array)], { type: 'video/mp4' })
}

export function isFFmpegSupported(): boolean {
  if (typeof window === 'undefined') return false
  return typeof SharedArrayBuffer !== 'undefined'
}
