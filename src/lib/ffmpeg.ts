'use client'

import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL, fetchFile } from '@ffmpeg/util'

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
      progress: Math.min(percent, 99),
      message: `処理中... ${percent}%`,
    })
  })

  onProgress?.({ progress: 0, message: 'FFmpegを読み込み中...' })

  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'

  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  })

  loaded = true
  onProgress?.({ progress: 10, message: 'FFmpeg準備完了' })

  return ffmpeg
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

  await ff.exec([
    '-i', 'input.mp4',
    '-vf', filterComplex,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    'output.mp4',
  ])

  onProgress?.({ progress: 90, message: '出力ファイルを準備中...' })

  // Read output file
  const outputData = await ff.readFile('output.mp4')

  // Clean up
  await ff.deleteFile('input.mp4')
  await ff.deleteFile('output.mp4')

  onProgress?.({ progress: 100, message: '完了!' })

  // Convert FileData to Blob
  return new Blob([new Uint8Array(outputData as Uint8Array)], { type: 'video/mp4' })
}

export async function trimVideo(
  inputFile: File,
  startTime: number,
  endTime: number,
  onProgress?: (progress: ProcessingProgress) => void
): Promise<Blob> {
  const ff = await loadFFmpeg(onProgress)

  onProgress?.({ progress: 15, message: '動画を読み込み中...' })

  const inputData = await fetchFile(inputFile)
  await ff.writeFile('input.mp4', inputData)

  onProgress?.({ progress: 25, message: 'トリミング中...' })

  const duration = endTime - startTime

  await ff.exec([
    '-i', 'input.mp4',
    '-ss', startTime.toString(),
    '-t', duration.toString(),
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    'output.mp4',
  ])

  onProgress?.({ progress: 90, message: '出力ファイルを準備中...' })

  const outputData = await ff.readFile('output.mp4')

  await ff.deleteFile('input.mp4')
  await ff.deleteFile('output.mp4')

  onProgress?.({ progress: 100, message: '完了!' })

  // Convert FileData to Blob
  return new Blob([new Uint8Array(outputData as Uint8Array)], { type: 'video/mp4' })
}

export function isFFmpegSupported(): boolean {
  return typeof SharedArrayBuffer !== 'undefined'
}
