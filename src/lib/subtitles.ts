'use client'

import { pipeline, env } from '@huggingface/transformers'

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

// Whisper transcription pipeline singleton
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

// Extract audio from video using decodeAudioData (fast, works on desktop)
async function extractAudioDecode(videoUrl: string, audioContext: AudioContext): Promise<Float32Array> {
  console.log('Extracting audio via decodeAudioData:', videoUrl)

  const response = await fetch(videoUrl)
  const arrayBuffer = await response.arrayBuffer()
  console.log('Fetched video data, size:', arrayBuffer.byteLength)

  if (audioContext.state === 'suspended') {
    await audioContext.resume()
  }

  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
  console.log('Decoded audio:', audioBuffer.duration.toFixed(1), 's,', audioBuffer.sampleRate, 'Hz,', audioBuffer.numberOfChannels, 'ch')

  // Mix to mono
  let monoData: Float32Array
  if (audioBuffer.numberOfChannels === 1) {
    monoData = audioBuffer.getChannelData(0)
  } else {
    const left = audioBuffer.getChannelData(0)
    const right = audioBuffer.getChannelData(1)
    monoData = new Float32Array(left.length)
    for (let i = 0; i < left.length; i++) {
      monoData[i] = (left[i] + right[i]) / 2
    }
  }

  return resampleTo16kHz(monoData, audioBuffer.sampleRate)
}

// Extract audio by playing video and capturing via Web Audio API (works on iOS Safari)
// iOS Safari's decodeAudioData can't handle MP4/MOV containers, but <video> can play them.
// We play the video at 2x speed through createMediaElementSource and capture PCM output.
async function extractAudioPlayback(
  videoUrl: string,
  audioContext: AudioContext,
  onProgress?: (progress: number, message: string) => void
): Promise<Float32Array> {
  console.log('Extracting audio via playback capture:', videoUrl)

  if (audioContext.state === 'suspended') {
    await audioContext.resume()
  }

  return new Promise<Float32Array>((resolve, reject) => {
    const video = document.createElement('video')
    video.playsInline = true
    video.preload = 'auto'
    video.src = videoUrl

    let resolved = false
    const playbackRate = 2

    const cleanup = (source?: AudioNode, processor?: AudioNode, gain?: AudioNode) => {
      try { source?.disconnect() } catch { /* ignore */ }
      try { processor?.disconnect() } catch { /* ignore */ }
      try { gain?.disconnect() } catch { /* ignore */ }
      video.pause()
      video.removeAttribute('src')
      video.load()
    }

    video.onloadedmetadata = async () => {
      try {
        const duration = video.duration
        console.log('Video duration:', duration, 's, will capture at', playbackRate + 'x')

        const source = audioContext.createMediaElementSource(video)
        const bufferSize = 4096
        const processor = audioContext.createScriptProcessor(bufferSize, 1, 1)
        // Mute output: route through zero-gain node
        const gainNode = audioContext.createGain()
        gainNode.gain.value = 0

        source.connect(processor)
        processor.connect(gainNode)
        gainNode.connect(audioContext.destination)

        const chunks: Float32Array[] = []

        processor.onaudioprocess = (e) => {
          const input = e.inputBuffer.getChannelData(0)
          chunks.push(new Float32Array(input))
        }

        video.ontimeupdate = () => {
          if (duration > 0) {
            const pct = Math.round((video.currentTime / duration) * 100)
            onProgress?.(5 + pct * 0.15, `音声を抽出中... ${pct}%`)
          }
        }

        // Timeout safety: duration/playbackRate + 10s buffer
        const timeoutMs = ((duration / playbackRate) + 10) * 1000
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true
            cleanup(source, processor, gainNode)
            reject(new Error('音声抽出がタイムアウトしました'))
          }
        }, timeoutMs)

        video.onended = () => {
          if (resolved) return
          resolved = true
          clearTimeout(timeout)

          const totalLength = chunks.reduce((acc, c) => acc + c.length, 0)
          console.log('Captured', totalLength, 'samples at', audioContext.sampleRate, 'Hz')

          const fullAudio = new Float32Array(totalLength)
          let offset = 0
          for (const chunk of chunks) {
            fullAudio.set(chunk, offset)
            offset += chunk.length
          }

          cleanup(source, processor, gainNode)

          // At 2x playback, each captured sample represents 2x real time
          // Effective sample rate = audioContext.sampleRate / playbackRate
          const effectiveRate = audioContext.sampleRate / playbackRate
          resolve(resampleTo16kHz(fullAudio, effectiveRate))
        }

        video.playbackRate = playbackRate
        await video.play()
      } catch (e) {
        if (!resolved) {
          resolved = true
          cleanup()
          reject(e)
        }
      }
    }

    video.onerror = () => {
      if (!resolved) {
        resolved = true
        cleanup()
        reject(new Error('動画の読み込みに失敗しました'))
      }
    }
  })
}

// Resample audio to 16kHz mono
function resampleTo16kHz(data: Float32Array, sourceSampleRate: number): Float32Array {
  const targetRate = 16000
  if (sourceSampleRate === targetRate) return data

  const ratio = sourceSampleRate / targetRate
  const newLength = Math.round(data.length / ratio)
  const resampled = new Float32Array(newLength)
  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio
    const floor = Math.floor(srcIndex)
    const ceil = Math.min(floor + 1, data.length - 1)
    const frac = srcIndex - floor
    resampled[i] = data[floor] * (1 - frac) + data[ceil] * frac
  }
  console.log('Resampled to 16kHz:', resampled.length, 'samples from', sourceSampleRate, 'Hz')
  return resampled
}

// Generate subtitles from video
export async function generateSubtitles(
  videoUrl: string,
  language: string = 'ja',
  onProgress?: (progress: number, message: string) => void,
  audioContext?: AudioContext
): Promise<SubtitleSegment[]> {
  onProgress?.(0, '字幕生成を開始...')

  // IMPORTANT: Extract audio FIRST before loading Whisper model
  // On mobile, loading both AudioBuffer + WASM model simultaneously causes OOM
  // By extracting audio first, we use memory when it's clean, then free it before model load

  onProgress?.(5, '音声を抽出中...')

  // Step 1: Extract audio (no WASM loaded yet = maximum available memory)
  const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  let audioData: Float32Array
  try {
    const ctx = audioContext || new AudioContext()
    if (isMobile) {
      // Mobile: iOS Safari's decodeAudioData can't handle MP4/MOV containers
      // Use video playback capture instead (plays video at 2x and records audio)
      onProgress?.(5, '音声を抽出中（再生キャプチャ）...')
      audioData = await extractAudioPlayback(videoUrl, ctx, onProgress)
    } else {
      // Desktop: fast decodeAudioData
      audioData = await extractAudioDecode(videoUrl, ctx)
    }
    if (!audioContext) await ctx.close()
  } catch (e) {
    throw new Error(`[Step1:音声抽出] ${e instanceof Error ? e.message : String(e)}`)
  }

  onProgress?.(20, 'AIモデルを読み込み中...')

  // Step 2: Load Whisper model (audio extraction is done, memory freed for model)
  let whisper
  try {
    whisper = await getTranscriber(onProgress)
  } catch (e) {
    throw new Error(`[Step2:モデル読込] ${e instanceof Error ? e.message : String(e)}`)
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
