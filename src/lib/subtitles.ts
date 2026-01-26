'use client'

import { pipeline, env } from '@huggingface/transformers'
import { loadFFmpeg } from './ffmpeg'

export interface SubtitleSegment {
  id: string
  startTime: number
  endTime: number
  text: string
}

export interface SubtitleStyle {
  fontSize: 'small' | 'medium' | 'large'
  position: 'top' | 'center' | 'bottom'
  color: string
  backgroundColor: string
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontSize: 'medium',
  position: 'bottom',
  color: '#ffffff',
  backgroundColor: 'rgba(0, 0, 0, 0.7)'
}

// Transcription pipeline singleton
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transcriber: any = null
let isLoading = false

// Initialize the Whisper pipeline
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getTranscriber(
  onProgress?: (progress: number, message: string) => void
): Promise<any> {
  if (transcriber) return transcriber

  if (isLoading) {
    // Wait for existing loading to complete
    while (isLoading) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (transcriber) return transcriber
  }

  isLoading = true

  // Mobile: use whisper-tiny Q8 (~45MB) to avoid OOM crash
  // Desktop: use whisper-small Q8 (~249MB) for better accuracy
  const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  const modelName = isMobile ? 'Xenova/whisper-tiny' : 'Xenova/whisper-small'

  try {
    // Self-host ONNX WASM files to avoid COEP blocking cross-origin dynamic imports (iOS Safari)
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.wasmPaths = '/'
      // Mobile: force single-threaded WASM to avoid Worker spawn failures
      if (isMobile) {
        env.backends.onnx.wasm.numThreads = 1
      }
    }

    onProgress?.(0, isMobile ? '軽量AIモデルを準備中...' : 'AIモデルを準備中...')

    transcriber = await pipeline(
      'automatic-speech-recognition',
      modelName,
      {
        dtype: 'q8',
      }
    )

    onProgress?.(30, '準備完了')
    return transcriber
  } catch (error) {
    console.error(`Failed to load ${modelName} q8:`, error)
    // Fallback: if whisper-small failed, try whisper-tiny
    if (!isMobile) {
      try {
        onProgress?.(0, '軽量モデルで再試行中...')

        transcriber = await pipeline(
          'automatic-speech-recognition',
          'Xenova/whisper-tiny',
          {
            dtype: 'q8',
          }
        )
        onProgress?.(30, '準備完了')
        return transcriber
      } catch (fallbackError) {
        isLoading = false
        throw new Error('Whisperモデルの読み込みに失敗しました。メモリ不足の可能性があります。')
      }
    }
    isLoading = false
    throw new Error('Whisperモデルの読み込みに失敗しました。メモリ不足の可能性があります。')
  } finally {
    isLoading = false
  }
}

// Extract audio from video and resample to 16kHz mono using FFmpeg
// FFmpeg handles any video format reliably on all platforms (including mobile Safari)
async function extractAudioFromVideo(videoUrl: string): Promise<Float32Array> {
  console.log('Extracting audio from:', videoUrl)

  // Fetch video data
  const response = await fetch(videoUrl)
  const arrayBuffer = await response.arrayBuffer()
  console.log('Fetched video data, size:', arrayBuffer.byteLength)

  // Use FFmpeg to extract audio as raw PCM float32, 16kHz, mono
  const ff = await loadFFmpeg()
  await ff.writeFile('subtitle_input.mp4', new Uint8Array(arrayBuffer))

  await ff.exec([
    '-i', 'subtitle_input.mp4',
    '-vn',                    // no video
    '-f', 'f32le',            // raw float32 little-endian
    '-acodec', 'pcm_f32le',  // PCM float32
    '-ar', '16000',           // 16kHz (Whisper requirement)
    '-ac', '1',               // mono
    '-y', 'subtitle_audio.raw'
  ])

  const rawData = await ff.readFile('subtitle_audio.raw')
  const float32 = new Float32Array(new Uint8Array(rawData as Uint8Array).buffer)
  console.log('Extracted audio: samples =', float32.length, 'duration =', (float32.length / 16000).toFixed(1), 's')

  // Cleanup
  try { await ff.deleteFile('subtitle_input.mp4') } catch { /* ignore */ }
  try { await ff.deleteFile('subtitle_audio.raw') } catch { /* ignore */ }

  return float32
}

// Generate subtitles from video
export async function generateSubtitles(
  videoUrl: string,
  language: string = 'ja',
  onProgress?: (progress: number, message: string) => void
): Promise<SubtitleSegment[]> {
  onProgress?.(0, '字幕生成を開始...')

  // Step 1: Get or initialize transcriber
  let whisper
  try {
    whisper = await getTranscriber(onProgress)
  } catch (e) {
    throw new Error(`[Step1:モデル読込] ${e instanceof Error ? e.message : String(e)}`)
  }

  onProgress?.(30, '音声を抽出中...')

  // Step 2: Extract audio from video using FFmpeg
  let audioData
  try {
    audioData = await extractAudioFromVideo(videoUrl)
  } catch (e) {
    throw new Error(`[Step2:音声抽出] ${e instanceof Error ? e.message : String(e)}`)
  }

  onProgress?.(50, '音声を認識中...')

  // Step 3: Transcribe with timestamps
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let result: any
  try {
    result = await whisper(audioData, {
      language,
      task: 'transcribe',
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      // Prevent hallucinations
      no_speech_threshold: 0.6,
      compression_ratio_threshold: 2.4,
    })
  } catch (e) {
    throw new Error(`[Step3:音声認識] ${e instanceof Error ? e.message : String(e)}`)
  }

  onProgress?.(90, '字幕を生成中...')

  console.log('Whisper result:', JSON.stringify(result, null, 2))

  // Detect hallucination (repetitive text)
  function isHallucination(text: string): boolean {
    // Check for repeating patterns (e.g., "自分の自分の自分の...")
    const words = text.split(/の|、|。/).filter(w => w.length > 0)
    if (words.length < 3) return false

    // Count repetitions
    const counts: Record<string, number> = {}
    for (const word of words) {
      counts[word] = (counts[word] || 0) + 1
    }

    // If any word repeats more than 3 times, it's likely hallucination
    const maxRepeat = Math.max(...Object.values(counts))
    return maxRepeat > 3
  }

  // Convert to subtitle segments
  const segments: SubtitleSegment[] = []

  if (result.chunks && Array.isArray(result.chunks) && result.chunks.length > 0) {
    console.log('Processing', result.chunks.length, 'chunks')
    for (let i = 0; i < result.chunks.length; i++) {
      const chunk = result.chunks[i]
      console.log(`Chunk ${i}:`, chunk)

      const text = chunk.text?.trim()
      if (!text) continue

      // Skip hallucinated chunks
      if (isHallucination(text)) {
        console.log(`Skipping hallucinated chunk ${i}:`, text.substring(0, 50) + '...')
        continue
      }

      // Handle timestamp - might be array [start, end] or object {start, end}
      let start: number | null = null
      let end: number | null = null

      if (Array.isArray(chunk.timestamp)) {
        start = chunk.timestamp[0]
        end = chunk.timestamp[1]
      } else if (chunk.timestamp && typeof chunk.timestamp === 'object') {
        start = chunk.timestamp.start
        end = chunk.timestamp.end
      }

      // Skip chunks with null end timestamp (usually hallucinations at the end)
      if (end === null || end === undefined) {
        console.log(`Skipping chunk ${i} with null end timestamp`)
        continue
      }

      // Use fallback for start if not available
      if (start === null || start === undefined) start = 0

      segments.push({
        id: `subtitle-${segments.length}`,
        startTime: start,
        endTime: end,
        text
      })
    }
  }

  // Fallback: use full text if no valid chunks
  if (segments.length === 0 && result.text) {
    const text = result.text.trim()
    if (text) {
      segments.push({
        id: 'subtitle-0',
        startTime: 0,
        endTime: 30,
        text
      })
    }
  }

  console.log('Generated segments:', segments)

  onProgress?.(100, '字幕生成完了')

  return segments
}

// Format time for display (0:00.0)
export function formatSubtitleTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = (seconds % 60).toFixed(1)
  return `${mins}:${secs.padStart(4, '0')}`
}

// Convert subtitles to SRT format
export function subtitlesToSRT(segments: SubtitleSegment[]): string {
  return segments.map((seg, i) => {
    const startTime = formatSRTTime(seg.startTime)
    const endTime = formatSRTTime(seg.endTime)
    return `${i + 1}\n${startTime} --> ${endTime}\n${seg.text}\n`
  }).join('\n')
}

function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 1000)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`
}

// Get current subtitle for a given time
export function getCurrentSubtitle(
  segments: SubtitleSegment[],
  currentTime: number
): SubtitleSegment | null {
  for (const segment of segments) {
    if (currentTime >= segment.startTime && currentTime <= segment.endTime) {
      return segment
    }
  }
  return null
}
