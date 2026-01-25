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

export interface TextOverlay {
  content: string
  position: 'top' | 'center' | 'bottom'
  fontSize: number
  color: string
}

// Multi-video project types
export interface VideoSource {
  id: string
  file: File
  url: string
  name: string
  duration?: number
}

export interface Clip {
  id: string
  sourceId: string      // Reference to VideoSource.id
  startTime: number     // seconds
  endTime: number       // seconds
  effects?: VideoEffects
}

export interface TimelineItem {
  clipId: string
  transition?: 'none' | 'fade' | 'crossfade'
  transitionDuration?: number  // seconds
}

export interface SubtitleSegment {
  startTime: number
  endTime: number
  text: string
}

export interface SubtitleOptions {
  segments: SubtitleSegment[]
  style: {
    fontSize: 'small' | 'medium' | 'large'
    position: 'top' | 'center' | 'bottom'
    color: string
    backgroundColor: string
  }
}

export interface Project {
  videos: VideoSource[]
  clips: Clip[]
  timeline: TimelineItem[]
  globalEffects: VideoEffects
  subtitles?: SubtitleOptions
}

export interface VideoEffects {
  // Basic adjustments
  brightness?: number      // -1 to 1
  contrast?: number        // 0 to 3
  saturation?: number      // 0 to 3

  // Transform
  speed?: number           // 0.25 to 4
  mute?: boolean
  flip?: boolean
  rotate?: number          // 0, 90, 180, 270

  // Trim
  trimStart?: number       // seconds
  trimEnd?: number         // seconds

  // Effects
  fadeIn?: number          // duration in seconds
  fadeOut?: number         // duration in seconds
  blur?: number            // 0 to 20
  sharpen?: number         // 0 to 2
  vignette?: number        // 0 to 1

  // Color presets
  preset?: 'none' | 'cinematic' | 'retro' | 'warm' | 'cool' | 'vibrant' | 'bw'

  // Crop/Aspect ratio
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | 'original'

  // Text overlay
  text?: TextOverlay
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
let fontLoaded = false
let fontFilename = 'font.ttf'

// Font URL - using a Japanese-capable font from reliable CDN
// Noto Sans CJK JP - full Japanese support (~16MB, but reliable)
const FONT_URLS = [
  'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf',
]

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

// Load font file into ffmpeg filesystem
async function loadFontToFFmpeg(ff: FFmpeg): Promise<boolean> {
  if (fontLoaded) return true

  for (const fontUrl of FONT_URLS) {
    try {
      console.log('[Subtitle] Trying to load font from:', fontUrl)
      const response = await fetch(fontUrl, { mode: 'cors' })
      if (!response.ok) {
        console.warn('[Subtitle] Failed to fetch font, status:', response.status)
        continue
      }

      const fontData = await response.arrayBuffer()
      console.log('[Subtitle] Font data size:', fontData.byteLength, 'bytes')

      if (fontData.byteLength < 1000) {
        console.warn('[Subtitle] Font file too small, likely invalid')
        continue
      }

      // Determine extension from URL
      let ext = 'ttf'
      if (fontUrl.includes('.woff')) ext = 'woff'
      else if (fontUrl.includes('.otf')) ext = 'otf'
      fontFilename = `font.${ext}`
      await ff.writeFile(fontFilename, new Uint8Array(fontData))
      fontLoaded = true
      console.log('[Subtitle] Font loaded successfully as', fontFilename)
      return true
    } catch (error) {
      console.warn('[Subtitle] Failed to load font:', error)
    }
  }

  console.warn('[Subtitle] All font sources failed, trying without custom font')
  return false
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

// Get color preset filter values
function getPresetFilters(preset: string): { brightness: number; contrast: number; saturation: number; gamma?: number } {
  switch (preset) {
    case 'cinematic':
      return { brightness: -0.05, contrast: 1.2, saturation: 0.85 }
    case 'retro':
      return { brightness: 0.05, contrast: 0.9, saturation: 0.7 }
    case 'warm':
      return { brightness: 0.05, contrast: 1.05, saturation: 1.1 }
    case 'cool':
      return { brightness: 0, contrast: 1.1, saturation: 0.9 }
    case 'vibrant':
      return { brightness: 0.1, contrast: 1.15, saturation: 1.4 }
    case 'bw':
      return { brightness: 0, contrast: 1.1, saturation: 0 }
    default:
      return { brightness: 0, contrast: 1, saturation: 1 }
  }
}

export async function processVideo(
  inputFile: File,
  format: string,
  onProgress?: (progress: ProcessingProgress) => void,
  _trimStart?: number,
  _trimEnd?: number,
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

  // Determine target dimensions based on aspect ratio
  let targetWidth = formatConfig.width
  let targetHeight = formatConfig.height

  if (effects?.aspectRatio && effects.aspectRatio !== 'original') {
    const ratioMap: Record<string, [number, number]> = {
      '16:9': [1920, 1080],
      '9:16': [1080, 1920],
      '1:1': [1080, 1080],
      '4:3': [1440, 1080],
    }
    const [w, h] = ratioMap[effects.aspectRatio] || [formatConfig.width, formatConfig.height]
    targetWidth = w
    targetHeight = h
  }

  // Scale and pad for format
  videoFilters.push(
    `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease`,
    `pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:black`
  )

  // Apply color effects
  let brightness = effects?.brightness || 0
  let contrast = effects?.contrast || 1
  let saturation = effects?.saturation || 1

  // Apply preset (combines with manual adjustments)
  if (effects?.preset && effects.preset !== 'none') {
    const presetValues = getPresetFilters(effects.preset)
    brightness += presetValues.brightness
    contrast *= presetValues.contrast
    saturation *= presetValues.saturation
  }

  // Apply eq filter for brightness, contrast, saturation
  if (brightness !== 0 || contrast !== 1 || saturation !== 1) {
    videoFilters.push(`eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`)
  }

  // Blur
  if (effects?.blur && effects.blur > 0) {
    const blurRadius = Math.min(effects.blur, 20)
    videoFilters.push(`boxblur=${blurRadius}:${blurRadius}`)
  }

  // Sharpen
  if (effects?.sharpen && effects.sharpen > 0) {
    const sharpenAmount = Math.min(effects.sharpen, 2)
    videoFilters.push(`unsharp=5:5:${sharpenAmount}:5:5:0`)
  }

  // Vignette
  if (effects?.vignette && effects.vignette > 0) {
    const vignetteAngle = Math.PI / 4 + (effects.vignette * Math.PI / 4)
    videoFilters.push(`vignette=angle=${vignetteAngle}`)
  }

  // Flip (horizontal mirror)
  if (effects?.flip) {
    videoFilters.push('hflip')
  }

  // Rotate
  if (effects?.rotate) {
    const rotations = Math.floor(effects.rotate / 90) % 4
    for (let i = 0; i < rotations; i++) {
      videoFilters.push('transpose=1')
    }
  }

  // Speed adjustment (setpts for video)
  if (effects?.speed && effects.speed !== 1) {
    videoFilters.push(`setpts=${1/effects.speed}*PTS`)
  }

  // Fade in
  if (effects?.fadeIn && effects.fadeIn > 0) {
    videoFilters.push(`fade=t=in:st=0:d=${effects.fadeIn}`)
  }

  // Note: Fade out is difficult without knowing video duration
  // For now, we'll skip fade out in the filter (user sees preview)
  // A more advanced implementation would probe the video first

  // Text overlay - using drawtext (may not work on all ffmpeg.wasm builds)
  // Fallback: text overlay is shown in CSS preview only
  if (effects?.text && effects.text.content) {
    try {
      const { content, position, fontSize, color } = effects.text
      let yPos = 'h-th-50'
      if (position === 'top') yPos = '50'
      else if (position === 'center') yPos = '(h-th)/2'

      // Escape special characters for ffmpeg
      const escapedText = content.replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/\\/g, '\\\\')
      videoFilters.push(`drawtext=text='${escapedText}':fontsize=${fontSize || 48}:fontcolor=${color || 'white'}:x=(w-tw)/2:y=${yPos}`)
    } catch {
      // If drawtext fails, text will only be visible in preview
      console.warn('drawtext filter not available, text will only be in preview')
    }
  }

  const filterComplex = videoFilters.join(',')

  // Build ffmpeg command
  const ffmpegArgs: string[] = []

  // Use effects trim values or fallback to function parameters
  const trimStart = effects?.trimStart ?? _trimStart
  const trimEnd = effects?.trimEnd ?? _trimEnd

  // Trim start
  if (trimStart !== undefined && trimStart > 0) {
    ffmpegArgs.push('-ss', trimStart.toFixed(3))
  }

  ffmpegArgs.push('-i', 'input.mp4')

  // Trim duration
  if (trimEnd !== undefined && trimStart !== undefined && trimEnd > trimStart) {
    const duration = trimEnd - trimStart
    ffmpegArgs.push('-t', duration.toFixed(3))
  } else if (trimEnd !== undefined && trimEnd > 0) {
    ffmpegArgs.push('-t', trimEnd.toFixed(3))
  }

  // Video filters
  ffmpegArgs.push('-vf', filterComplex)

  // Audio handling
  if (effects?.mute) {
    ffmpegArgs.push('-an')
  } else {
    // Audio filters
    const audioFilters: string[] = []

    // Speed for audio
    if (effects?.speed && effects.speed !== 1) {
      // atempo only accepts 0.5 to 2.0, so we may need to chain multiple filters
      let speed = effects.speed
      // For speeds > 2.0, chain multiple atempo=2.0
      while (speed > 2.0) {
        audioFilters.push('atempo=2.0')
        speed = speed / 2.0
      }
      // For speeds < 0.5, chain multiple atempo=0.5
      while (speed < 0.5) {
        audioFilters.push('atempo=0.5')
        speed = speed * 2.0
      }
      // Add remaining speed adjustment
      if (speed >= 0.5 && speed <= 2.0 && Math.abs(speed - 1) > 0.01) {
        audioFilters.push(`atempo=${speed.toFixed(4)}`)
      }
    }

    // Audio fade in
    if (effects?.fadeIn && effects.fadeIn > 0) {
      audioFilters.push(`afade=t=in:st=0:d=${effects.fadeIn}`)
    }

    if (audioFilters.length > 0) {
      ffmpegArgs.push('-af', audioFilters.join(','))
    }

    ffmpegArgs.push('-c:a', 'aac', '-b:a', '128k')
  }

  // Video codec
  ffmpegArgs.push(
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '28',
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

// Get video duration using HTML5 video element
export function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src)
      resolve(video.duration)
    }

    video.onerror = () => {
      URL.revokeObjectURL(video.src)
      reject(new Error('Failed to load video metadata'))
    }

    video.src = URL.createObjectURL(file)
  })
}

// Generate unique ID
export function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
}

// Convert hex color to ASS color format (&HAABBGGRR)
function hexToASSColor(hex: string, alpha: number = 0): string {
  // Remove # if present
  hex = hex.replace('#', '')

  // Parse RGB
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)

  // ASS uses AABBGGRR format (reverse of RGB, with alpha)
  const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase()
  const rHex = r.toString(16).padStart(2, '0').toUpperCase()
  const gHex = g.toString(16).padStart(2, '0').toUpperCase()
  const bHex = b.toString(16).padStart(2, '0').toUpperCase()

  return `&H${alphaHex}${bHex}${gHex}${rHex}`
}

// Parse rgba color to get alpha value
function parseRgbaAlpha(color: string): number {
  const match = color.match(/rgba?\([\d\s,]+,\s*([\d.]+)\)/)
  if (match) {
    return 1 - parseFloat(match[1]) // ASS alpha is inverted (0 = opaque, 255 = transparent)
  }
  if (color === 'transparent') return 1
  return 0 // Opaque by default
}

// Format time for ASS (H:MM:SS.cc)
function formatASSTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const cs = Math.floor((seconds % 1) * 100) // Centiseconds
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`
}

// Build drawtext filters for subtitles
function buildDrawtextFilters(
  segments: SubtitleSegment[],
  clipStartTime: number,
  style: SubtitleOptions['style'],
  _formatConfig: VideoFormat
): string {
  // Map font size
  const fontSizeMap = { small: 32, medium: 48, large: 64 }
  const fontSize = fontSizeMap[style.fontSize] || 48

  // Map position to y coordinate
  const yPosMap = {
    top: '50',
    center: '(h-th)/2',
    bottom: 'h-th-50'
  }
  const yPos = yPosMap[style.position] || 'h-th-50'

  // Convert color (remove # if present)
  const textColor = style.color?.replace('#', '') || 'ffffff'

  // Background box settings
  let boxSettings = ''
  if (style.backgroundColor && style.backgroundColor !== 'transparent') {
    // Parse background color and alpha
    let boxColor = '000000'
    let boxAlpha = 0.7

    if (style.backgroundColor.startsWith('rgba')) {
      const match = style.backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+),?\s*([\d.]+)?\)/)
      if (match) {
        const r = parseInt(match[1]).toString(16).padStart(2, '0')
        const g = parseInt(match[2]).toString(16).padStart(2, '0')
        const b = parseInt(match[3]).toString(16).padStart(2, '0')
        boxColor = `${r}${g}${b}`
        boxAlpha = match[4] ? parseFloat(match[4]) : 0.7
      }
    } else if (style.backgroundColor.startsWith('#')) {
      boxColor = style.backgroundColor.replace('#', '')
    }

    boxSettings = `:box=1:boxcolor=0x${boxColor}@${boxAlpha.toFixed(1)}:boxborderw=10`
  }

  // Build filter for each segment
  const drawtextParts = segments.map(seg => {
    // Adjust timestamps relative to clip start
    const start = Math.max(0, seg.startTime - clipStartTime)
    const end = Math.max(start + 0.1, seg.endTime - clipStartTime)

    // Escape text for ffmpeg drawtext
    // Need to escape: \ ' : %
    const escapedText = seg.text
      .replace(/\\/g, '\\\\\\\\')
      .replace(/'/g, "'\\\\\\''")
      .replace(/:/g, '\\:')
      .replace(/%/g, '\\%')

    // Build drawtext filter with enable expression for timing
    // Use fontfile if available, otherwise try without (might not support Japanese)
    const fontPart = fontLoaded ? `fontfile=${fontFilename}:` : ''
    return `drawtext=${fontPart}text='${escapedText}':fontsize=${fontSize}:fontcolor=0x${textColor}${boxSettings}:x=(w-tw)/2:y=${yPos}:enable='between(t\\,${start.toFixed(2)}\\,${end.toFixed(2)})'`
  })

  return drawtextParts.join(',')
}

// Generate ASS subtitle content
function generateASSContent(
  segments: SubtitleSegment[],
  clipStartTime: number,
  style: SubtitleOptions['style'],
  formatConfig: VideoFormat
): string {
  // Map font size
  const fontSizeMap = { small: 36, medium: 52, large: 72 }
  const fontSize = fontSizeMap[style.fontSize] || 52

  // Map position to ASS alignment (numpad style)
  // 1,2,3 = bottom; 4,5,6 = middle; 7,8,9 = top
  const alignmentMap = { bottom: 2, center: 5, top: 8 }
  const alignment = alignmentMap[style.position] || 2

  // Convert colors
  const primaryColor = hexToASSColor(style.color || '#ffffff')

  // Handle background color (could be rgba or hex)
  let backAlpha = 0.3 // Default semi-transparent
  let backColor = '&H4D000000' // Default black with alpha

  if (style.backgroundColor) {
    if (style.backgroundColor === 'transparent') {
      backColor = '&HFF000000' // Fully transparent
    } else if (style.backgroundColor.startsWith('rgba')) {
      backAlpha = parseRgbaAlpha(style.backgroundColor)
      backColor = hexToASSColor('000000', backAlpha)
    } else if (style.backgroundColor.startsWith('#')) {
      backColor = hexToASSColor(style.backgroundColor.replace('#', ''), 0.3)
    }
  }

  // ASS header
  const header = `[Script Info]
Title: Video Subtitles
ScriptType: v4.00+
PlayResX: ${formatConfig.width}
PlayResY: ${formatConfig.height}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans CJK JP,${fontSize},${primaryColor},&H000000FF,&H00000000,${backColor},0,0,0,0,100,100,0,0,3,2,1,${alignment},20,20,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

  // Generate dialogue lines
  const dialogues = segments.map(seg => {
    // Adjust timestamps relative to clip start
    const start = Math.max(0, seg.startTime - clipStartTime)
    const end = Math.max(start + 0.1, seg.endTime - clipStartTime)

    // Escape special characters in text
    const text = seg.text
      .replace(/\\/g, '\\\\')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      .replace(/\n/g, '\\N')

    return `Dialogue: 0,${formatASSTime(start)},${formatASSTime(end)},Default,,0,0,0,,${text}`
  }).join('\n')

  return header + dialogues
}

// Create empty project
export function createEmptyProject(): Project {
  return {
    videos: [],
    clips: [],
    timeline: [],
    globalEffects: {}
  }
}

// Process a full project with multiple videos
export async function processProject(
  project: Project,
  format: string,
  onProgress?: (progress: ProcessingProgress) => void
): Promise<Blob> {
  console.log('=== processProject called ===')
  console.log('Project:', JSON.stringify({
    videosCount: project.videos.length,
    clipsCount: project.clips.length,
    timelineCount: project.timeline.length,
    globalEffects: project.globalEffects,
    clips: project.clips.map(c => ({ id: c.id, sourceId: c.sourceId, startTime: c.startTime, endTime: c.endTime })),
    timeline: project.timeline
  }, null, 2))

  const ff = await loadFFmpeg(onProgress)
  const formatConfig = VIDEO_FORMATS[format] || VIDEO_FORMATS.tiktok

  // If no timeline, return error
  if (project.timeline.length === 0) {
    throw new Error('タイムラインにクリップがありません')
  }

  onProgress?.({ progress: 10, message: '動画を読み込み中...' })

  // Write all source videos to ffmpeg filesystem
  const videoFileMap: Record<string, string> = {}
  for (let i = 0; i < project.videos.length; i++) {
    const video = project.videos[i]
    const filename = `input_${i}.mp4`
    const arrayBuffer = await video.file.arrayBuffer()
    await ff.writeFile(filename, new Uint8Array(arrayBuffer))
    videoFileMap[video.id] = filename
    onProgress?.({ progress: 10 + (i / project.videos.length) * 20, message: `動画${i + 1}を読み込み中...` })
  }

  onProgress?.({ progress: 30, message: 'クリップを処理中...' })

  // Load font if subtitles are present
  if (project.subtitles && project.subtitles.segments.length > 0) {
    onProgress?.({ progress: 32, message: 'フォントを読み込み中...' })
    await loadFontToFFmpeg(ff)
  }

  // Process each clip in timeline
  const processedClips: string[] = []
  const assFiles: string[] = []

  for (let i = 0; i < project.timeline.length; i++) {
    const timelineItem = project.timeline[i]
    const clip = project.clips.find(c => c.id === timelineItem.clipId)

    if (!clip) continue

    const sourceFile = videoFileMap[clip.sourceId]
    if (!sourceFile) continue

    const clipOutputFile = `clip_${i}.mp4`

    // Build filter for this clip
    const filters: string[] = []

    // Scale to target format
    filters.push(
      `scale=${formatConfig.width}:${formatConfig.height}:force_original_aspect_ratio=decrease`,
      `pad=${formatConfig.width}:${formatConfig.height}:(ow-iw)/2:(oh-ih)/2:black`
    )

    // Apply clip-specific effects
    const effects = { ...project.globalEffects, ...clip.effects }

    let brightness = effects.brightness || 0
    let contrast = effects.contrast || 1
    let saturation = effects.saturation || 1

    if (effects.preset && effects.preset !== 'none') {
      const presetValues = getPresetFilters(effects.preset)
      brightness += presetValues.brightness
      contrast *= presetValues.contrast
      saturation *= presetValues.saturation
    }

    if (brightness !== 0 || contrast !== 1 || saturation !== 1) {
      filters.push(`eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`)
    }

    if (effects.blur && effects.blur > 0) {
      filters.push(`boxblur=${Math.min(effects.blur, 20)}:${Math.min(effects.blur, 20)}`)
    }

    if (effects.flip) {
      filters.push('hflip')
    }

    if (effects.rotate) {
      const rotations = Math.floor(effects.rotate / 90) % 4
      for (let r = 0; r < rotations; r++) {
        filters.push('transpose=1')
      }
    }

    if (effects.speed && effects.speed !== 1) {
      filters.push(`setpts=${1/effects.speed}*PTS`)
    }

    // Add fade transition if specified
    if (timelineItem.transition === 'fade' && i > 0) {
      const fadeDuration = timelineItem.transitionDuration || 0.5
      filters.push(`fade=t=in:st=0:d=${fadeDuration}`)
    }

    // Add subtitles using ASS format (libass is enabled in ffmpeg.wasm)
    let assFilename: string | null = null
    if (project.subtitles && project.subtitles.segments.length > 0) {
      const { segments, style } = project.subtitles
      const clipStart = clip.startTime
      const clipEnd = clip.endTime

      // Filter segments that overlap with this clip
      const clipSubtitles = segments.filter(seg =>
        seg.endTime > clipStart && seg.startTime < clipEnd
      )

      if (clipSubtitles.length > 0) {
        try {
          // Create ASS subtitle file
          const assContent = generateASSContent(clipSubtitles, clipStart, style, formatConfig)
          assFilename = `subs_${i}.ass`
          await ff.writeFile(assFilename, assContent)
          assFiles.push(assFilename)

          // Use ASS filter with fontsdir option (requires libass which is enabled)
          // Point to current directory where font.otf is located
          if (fontLoaded) {
            filters.push(`ass=${assFilename}:fontsdir=.`)
          } else {
            filters.push(`ass=${assFilename}`)
          }
          console.log(`Added ASS subtitles for clip ${i}:`, clipSubtitles.length, 'segments', 'fontLoaded:', fontLoaded)
          console.log('ASS content preview:', assContent.substring(0, 500))
        } catch (subError) {
          console.warn(`Failed to add subtitles for clip ${i}:`, subError)
          assFilename = null
        }
      }
    }

    // Build ffmpeg command for this clip
    const clipArgs: string[] = [
      '-ss', clip.startTime.toFixed(3),
      '-i', sourceFile,
      '-t', (clip.endTime - clip.startTime).toFixed(3),
      '-vf', filters.join(',')
    ]

    // Audio handling
    if (effects.mute) {
      clipArgs.push('-an')
    } else {
      const audioFilters: string[] = []
      if (effects.speed && effects.speed !== 1) {
        let speed = effects.speed
        while (speed > 2.0) {
          audioFilters.push('atempo=2.0')
          speed = speed / 2.0
        }
        while (speed < 0.5) {
          audioFilters.push('atempo=0.5')
          speed = speed * 2.0
        }
        if (speed >= 0.5 && speed <= 2.0 && Math.abs(speed - 1) > 0.01) {
          audioFilters.push(`atempo=${speed.toFixed(4)}`)
        }
      }
      if (audioFilters.length > 0) {
        clipArgs.push('-af', audioFilters.join(','))
      }
      clipArgs.push('-c:a', 'aac', '-b:a', '128k')
    }

    clipArgs.push(
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '28',
      '-y',
      clipOutputFile
    )

    console.log(`=== Processing clip ${i} ===`)
    console.log('Clip args:', clipArgs.join(' '))
    console.log('Effects applied:', effects)

    try {
      await ff.exec(clipArgs)
      processedClips.push(clipOutputFile)
      console.log(`Clip ${i} processed successfully`)
    } catch (error) {
      console.error(`Failed to process clip ${i}:`, error)

      // If subtitles/ass/drawtext filter might have caused the error, retry without it
      const hasSubtitlesFilter = filters.some(f => f.startsWith('subtitles=') || f.startsWith('drawtext=') || f.startsWith('ass='))
      if (hasSubtitlesFilter) {
        console.log('Retrying without subtitles filter...')
        const filtersWithoutSubs = filters.filter(f => !f.startsWith('subtitles='))
        const retryArgs = [
          '-ss', clip.startTime.toFixed(3),
          '-i', sourceFile,
          '-t', (clip.endTime - clip.startTime).toFixed(3),
          '-vf', filtersWithoutSubs.join(',')
        ]

        if (effects.mute) {
          retryArgs.push('-an')
        } else {
          const audioFilters: string[] = []
          if (effects.speed && effects.speed !== 1) {
            let speed = effects.speed
            while (speed > 2.0) { audioFilters.push('atempo=2.0'); speed = speed / 2.0 }
            while (speed < 0.5) { audioFilters.push('atempo=0.5'); speed = speed * 2.0 }
            if (speed >= 0.5 && speed <= 2.0 && Math.abs(speed - 1) > 0.01) {
              audioFilters.push(`atempo=${speed.toFixed(4)}`)
            }
          }
          if (audioFilters.length > 0) retryArgs.push('-af', audioFilters.join(','))
          retryArgs.push('-c:a', 'aac', '-b:a', '128k')
        }

        retryArgs.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '28', '-y', clipOutputFile)

        try {
          await ff.exec(retryArgs)
          processedClips.push(clipOutputFile)
          console.log(`Clip ${i} processed successfully (without subtitles)`)
        } catch (retryError) {
          console.error(`Retry failed for clip ${i}:`, retryError)
          throw new Error(`クリップ${i + 1}の処理に失敗しました`)
        }
      } else {
        throw new Error(`クリップ${i + 1}の処理に失敗しました`)
      }
    }

    onProgress?.({ progress: 30 + (i / project.timeline.length) * 40, message: `クリップ${i + 1}を処理中...` })
  }

  onProgress?.({ progress: 70, message: '動画を結合中...' })

  // If only one clip, just rename it
  if (processedClips.length === 1) {
    const outputData = await ff.readFile(processedClips[0])

    // Cleanup
    for (const file of [...Object.values(videoFileMap), ...processedClips, ...assFiles]) {
      try { await ff.deleteFile(file) } catch { /* ignore */ }
    }

    onProgress?.({ progress: 100, message: '完了!' })
    return new Blob([new Uint8Array(outputData as Uint8Array)], { type: 'video/mp4' })
  }

  // Create concat file list
  let concatList = ''
  for (const clipFile of processedClips) {
    concatList += `file '${clipFile}'\n`
  }
  await ff.writeFile('concat_list.txt', concatList)

  // Concatenate all clips
  const concatArgs = [
    '-f', 'concat',
    '-safe', '0',
    '-i', 'concat_list.txt',
    '-c', 'copy',
    '-y',
    'output.mp4'
  ]

  try {
    await ff.exec(concatArgs)
  } catch (error) {
    console.error('Concat error:', error)
    throw new Error('動画の結合に失敗しました')
  }

  onProgress?.({ progress: 90, message: '出力ファイルを準備中...' })

  const outputData = await ff.readFile('output.mp4')

  // Cleanup all temporary files
  for (const file of [...Object.values(videoFileMap), ...processedClips, ...assFiles, 'concat_list.txt', 'output.mp4']) {
    try { await ff.deleteFile(file) } catch { /* ignore */ }
  }

  onProgress?.({ progress: 100, message: '完了!' })

  return new Blob([new Uint8Array(outputData as Uint8Array)], { type: 'video/mp4' })
}
