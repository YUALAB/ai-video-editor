'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import {
  Download, Loader2, AlertTriangle, Send, Plus, Film,
  Play, Pause, SkipBack, Volume2, VolumeX
} from 'lucide-react'
import {
  processProject,
  isFFmpegSupported,
  getVideoDuration,
  generateId,
  createEmptyProject,
  type ProcessingProgress,
  type VideoEffects,
  type Project,
  type VideoSource,
  type Clip,
  type TimelineItem
} from '@/lib/ffmpeg'
import { callAI, extractVideoFrames, extractFramesForSceneAnalysis, type ConversationMessage } from '@/lib/ai'
import {
  generateSubtitles,
  getCurrentSubtitle,
  type SubtitleSegment,
  type SubtitleStyle,
  DEFAULT_SUBTITLE_STYLE
} from '@/lib/subtitles'

const MAX_FILE_SIZE_MB = 200
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024
const DEFAULT_API_KEY = 'ddd559c40b854464bdb2febcb26adde7.xcQXenBGBQW0ka8QcMa9TTxK'

type MessageType = {
  role: 'user' | 'ai'
  text?: string
  video?: {
    url: string
    name: string
    isOutput?: boolean
    videoIndex?: number  // For multiple videos
  }
}

// Preset values for CSS preview
const PRESET_VALUES: Record<string, { brightness: number; contrast: number; saturation: number; sepia?: number }> = {
  cinematic: { brightness: 0.95, contrast: 1.2, saturation: 0.85 },
  retro: { brightness: 1.05, contrast: 0.9, saturation: 0.7, sepia: 0.3 },
  warm: { brightness: 1.05, contrast: 1.05, saturation: 1.1 },
  cool: { brightness: 1, contrast: 1.1, saturation: 0.9 },
  vibrant: { brightness: 1.1, contrast: 1.15, saturation: 1.4 },
  bw: { brightness: 1, contrast: 1.1, saturation: 0 },
}

// Convert effects to CSS filter string
function effectsToCssFilter(effects: VideoEffects): string {
  const filters: string[] = []
  let brightness = 1
  let contrast = 1
  let saturation = 1
  let sepia = 0

  if (effects.preset && effects.preset !== 'none' && PRESET_VALUES[effects.preset]) {
    const preset = PRESET_VALUES[effects.preset]
    brightness = preset.brightness
    contrast = preset.contrast
    saturation = preset.saturation
    sepia = preset.sepia || 0
  }

  if (effects.brightness !== undefined) brightness += effects.brightness
  if (effects.contrast !== undefined) contrast *= effects.contrast
  if (effects.saturation !== undefined) saturation *= effects.saturation

  if (brightness !== 1) filters.push(`brightness(${brightness})`)
  if (contrast !== 1) filters.push(`contrast(${contrast})`)
  if (saturation !== 1) filters.push(`saturate(${saturation})`)
  if (sepia > 0) filters.push(`sepia(${sepia})`)
  if (effects.blur && effects.blur > 0) filters.push(`blur(${effects.blur}px)`)

  return filters.length > 0 ? filters.join(' ') : 'none'
}

// Convert effects to CSS transform string
function effectsToCssTransform(effects: VideoEffects): string {
  const transforms: string[] = []
  if (effects.flip) transforms.push('scaleX(-1)')
  if (effects.rotate) transforms.push(`rotate(${effects.rotate}deg)`)
  return transforms.length > 0 ? transforms.join(' ') : 'none'
}

// Get preset display name
function getPresetName(preset: string): string {
  const names: Record<string, string> = {
    cinematic: 'シネマティック', retro: 'レトロ', warm: '暖色',
    cool: '寒色', vibrant: 'ビビッド', bw: 'モノクロ',
  }
  return names[preset] || preset
}

export function VideoEditor() {
  // Project state (multi-video support)
  const [project, setProject] = useState<Project>(createEmptyProject())

  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState<ProcessingProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSupported, setIsSupported] = useState(true)

  // AI states
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiMessages, setAiMessages] = useState<MessageType[]>([
    { role: 'ai', text: 'こんにちは！動画編集AIです。\n\n左下の＋ボタンから動画を追加してください。\n追加した動画は自動的にタイムラインに入ります。\n\n例：「明るくして」「シネマティックに」「2倍速で」' }
  ])
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [format, setFormat] = useState<string>('tiktok')

  // Preview states
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [totalDuration, setTotalDuration] = useState(0)
  const [activeClipIndex, setActiveClipIndex] = useState(0)
  const [isMuted, setIsMuted] = useState(false)

  // Subtitle states
  const [subtitles, setSubtitles] = useState<SubtitleSegment[]>([])
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>(DEFAULT_SUBTITLE_STYLE)
  const [isGeneratingSubtitles, setIsGeneratingSubtitles] = useState(false)
  const [subtitleProgress, setSubtitleProgress] = useState<{ progress: number; message: string } | null>(null)

  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewVideoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)

  useEffect(() => {
    setIsSupported(isFFmpegSupported())
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [aiMessages])

  // Calculate total timeline duration
  useEffect(() => {
    if (project.timeline.length === 0) {
      setTotalDuration(0)
      return
    }

    let total = 0
    for (const item of project.timeline) {
      const clip = project.clips.find(c => c.id === item.clipId)
      if (clip) {
        const clipDuration = (clip.endTime - clip.startTime) / (project.globalEffects.speed || 1)
        total += clipDuration
      }
    }
    setTotalDuration(total)
  }, [project.timeline, project.clips, project.globalEffects.speed])

  // Get current clip and time position for preview
  const getCurrentPreviewState = useCallback(() => {
    if (project.timeline.length === 0) return null

    let accumulatedTime = 0
    for (let i = 0; i < project.timeline.length; i++) {
      const item = project.timeline[i]
      const clip = project.clips.find(c => c.id === item.clipId)
      if (!clip) continue

      const clipDuration = (clip.endTime - clip.startTime) / (project.globalEffects.speed || 1)

      if (currentTime < accumulatedTime + clipDuration) {
        const video = project.videos.find(v => v.id === clip.sourceId)
        const timeInClip = (currentTime - accumulatedTime) * (project.globalEffects.speed || 1) + clip.startTime
        return {
          clipIndex: i,
          video,
          clip,
          timeInClip,
          clipStartInTimeline: accumulatedTime,
          clipEndInTimeline: accumulatedTime + clipDuration
        }
      }
      accumulatedTime += clipDuration
    }

    // Return last clip if beyond end
    const lastItem = project.timeline[project.timeline.length - 1]
    const lastClip = project.clips.find(c => c.id === lastItem.clipId)
    const lastVideo = lastClip ? project.videos.find(v => v.id === lastClip.sourceId) : null
    return {
      clipIndex: project.timeline.length - 1,
      video: lastVideo,
      clip: lastClip,
      timeInClip: lastClip?.endTime || 0,
      clipStartInTimeline: accumulatedTime,
      clipEndInTimeline: accumulatedTime
    }
  }, [project, currentTime])

  // Handle preview playback with requestAnimationFrame for smooth performance
  useEffect(() => {
    if (!isPlaying || project.timeline.length === 0) return

    let animationId: number
    let lastTime = performance.now()

    const animate = (now: number) => {
      const delta = (now - lastTime) / 1000 // Convert to seconds
      lastTime = now

      setCurrentTime(prev => {
        const next = prev + delta
        if (next >= totalDuration) {
          setIsPlaying(false)
          return 0
        }
        return next
      })

      animationId = requestAnimationFrame(animate)
    }

    animationId = requestAnimationFrame(animate)

    return () => cancelAnimationFrame(animationId)
  }, [isPlaying, totalDuration, project.timeline.length])

  // Sync video element with current time (throttled for mobile performance)
  const lastSyncRef = useRef(0)
  useEffect(() => {
    const state = getCurrentPreviewState()
    if (!state || !previewVideoRef.current) return

    const video = previewVideoRef.current
    const now = performance.now()

    // Update active clip index for display
    if (state.clipIndex !== activeClipIndex) {
      setActiveClipIndex(state.clipIndex)
    }

    // Throttle video sync to every 250ms for mobile performance
    if (now - lastSyncRef.current > 250 || !isPlaying) {
      lastSyncRef.current = now

      // Sync video time only if significantly different
      if (Math.abs(video.currentTime - state.timeInClip) > 0.5) {
        video.currentTime = state.timeInClip
      }
    }

    // Sync playback state
    if (isPlaying && video.paused) {
      video.play().catch(() => {})
    } else if (!isPlaying && !video.paused) {
      video.pause()
    }

    // Sync playback rate
    const speed = project.globalEffects.speed || 1
    if (video.playbackRate !== speed) {
      video.playbackRate = speed
    }
  }, [currentTime, isPlaying, getCurrentPreviewState, activeClipIndex, project.globalEffects.speed])

  const handlePlayPause = () => {
    if (project.timeline.length === 0) return
    setIsPlaying(!isPlaying)
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value)
    setCurrentTime(time)
    setIsPlaying(false)
  }

  const handleRestart = () => {
    setCurrentTime(0)
    setIsPlaying(false)
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Add video to project
  const addVideoToProject = useCallback(async (file: File) => {
    setError(null)

    if (!file.type.startsWith('video/')) {
      setError('動画ファイルのみアップロードできます')
      return
    }

    if (file.size > MAX_FILE_SIZE) {
      setError(`ファイルサイズは${MAX_FILE_SIZE_MB}MB以下にしてください`)
      return
    }

    try {
      const duration = await getVideoDuration(file)
      const url = URL.createObjectURL(file)
      const videoId = generateId()
      const clipId = generateId()

      const newVideo: VideoSource = {
        id: videoId,
        file,
        url,
        name: file.name,
        duration
      }

      // Auto-create clip for the full video
      const newClip: Clip = {
        id: clipId,
        sourceId: videoId,
        startTime: 0,
        endTime: duration
      }

      // Auto-add to timeline
      const newTimelineItem: TimelineItem = {
        clipId,
        transition: 'none'
      }

      setProject(prev => ({
        ...prev,
        videos: [...prev.videos, newVideo],
        clips: [...prev.clips, newClip],
        timeline: [...prev.timeline, newTimelineItem]
      }))

      const videoIndex = project.videos.length + 1

      // Notify user - video is automatically on timeline
      setAiMessages(prev => [
        ...prev,
        { role: 'ai', text: `動画${videoIndex}「${file.name}」を追加しました（${duration.toFixed(1)}秒）\n\nタイムラインに自動追加済みです。編集指示をどうぞ！` }
      ])
    } catch (err) {
      setError('動画の読み込みに失敗しました')
      console.error(err)
    }
  }, [project.videos.length])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files) {
      Array.from(files).forEach(file => addVideoToProject(file))
    }
    e.target.value = '' // Reset input
  }

  const handleAddClick = () => {
    fileInputRef.current?.click()
  }

  const handleDownload = (url: string) => {
    const a = document.createElement('a')
    a.href = url
    a.download = `edited_${format}_${Date.now()}.mp4`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  // Process AI response and update project
  const processAIResponse = useCallback((response: {
    message: string
    effects?: Partial<VideoEffects>
    projectAction?: {
      type: 'addClip' | 'removeClip' | 'reorderTimeline' | 'clearTimeline' | 'setGlobalEffects' | 'trimClip' | 'splitClip' | 'replaceTimeline' | 'setSubtitleStyle'
      videoIndex?: number
      startTime?: number
      endTime?: number
      clipIndex?: number
      newOrder?: number[]
      effects?: Partial<VideoEffects>
      transition?: 'none' | 'fade' | 'crossfade'
      newStartTime?: number
      newEndTime?: number | null
      splitAt?: number
      clips?: Array<{
        videoIndex: number
        startTime: number
        endTime: number
        transition?: 'none' | 'fade' | 'crossfade'
      }>
      subtitleStyle?: {
        fontSize?: 'small' | 'medium' | 'large'
        position?: 'top' | 'center' | 'bottom'
        color?: string
        backgroundColor?: string
      }
    }
    understood: boolean
  }) => {
    if (!response.understood) return

    const action = response.projectAction

    if (action) {
      setProject(prev => {
        const newProject = { ...prev }

        switch (action.type) {
          case 'addClip': {
            if (action.videoIndex !== undefined && action.videoIndex > 0 && action.videoIndex <= prev.videos.length) {
              const video = prev.videos[action.videoIndex - 1]
              const clipId = generateId()

              const newClip: Clip = {
                id: clipId,
                sourceId: video.id,
                startTime: action.startTime ?? 0,
                endTime: action.endTime ?? (video.duration || 10),
                effects: action.effects
              }

              const newTimelineItem: TimelineItem = {
                clipId,
                transition: action.transition || 'none',
                transitionDuration: action.transition === 'fade' ? 0.5 : undefined
              }

              newProject.clips = [...prev.clips, newClip]
              newProject.timeline = [...prev.timeline, newTimelineItem]
            }
            break
          }

          case 'removeClip': {
            if (action.clipIndex !== undefined && action.clipIndex >= 0) {
              const clipToRemove = prev.timeline[action.clipIndex]
              if (clipToRemove) {
                newProject.timeline = prev.timeline.filter((_, i) => i !== action.clipIndex)
                newProject.clips = prev.clips.filter(c => c.id !== clipToRemove.clipId)
              }
            }
            break
          }

          case 'reorderTimeline': {
            if (action.newOrder) {
              newProject.timeline = action.newOrder
                .filter(i => i >= 0 && i < prev.timeline.length)
                .map(i => prev.timeline[i])
            }
            break
          }

          case 'clearTimeline': {
            newProject.timeline = []
            newProject.clips = []
            break
          }

          case 'setGlobalEffects': {
            if (action.effects) {
              newProject.globalEffects = { ...prev.globalEffects, ...action.effects }
            }
            break
          }

          case 'trimClip': {
            if (action.clipIndex !== undefined && action.clipIndex >= 0 && action.clipIndex < prev.timeline.length) {
              const timelineItem = prev.timeline[action.clipIndex]
              const clipToTrim = prev.clips.find(c => c.id === timelineItem.clipId)
              if (clipToTrim) {
                const updatedClip = { ...clipToTrim }
                if (action.newStartTime !== undefined) {
                  updatedClip.startTime = action.newStartTime
                }
                if (action.newEndTime !== undefined && action.newEndTime !== null) {
                  updatedClip.endTime = action.newEndTime
                }
                newProject.clips = prev.clips.map(c => c.id === clipToTrim.id ? updatedClip : c)
              }
            }
            break
          }

          case 'replaceTimeline': {
            // Auto-edit: Replace entire timeline with AI-suggested clips
            if (action.clips && Array.isArray(action.clips)) {
              const newClips: Clip[] = []
              const newTimeline: TimelineItem[] = []

              for (const clipDef of action.clips) {
                if (clipDef.videoIndex > 0 && clipDef.videoIndex <= prev.videos.length) {
                  const video = prev.videos[clipDef.videoIndex - 1]
                  const clipId = generateId()

                  newClips.push({
                    id: clipId,
                    sourceId: video.id,
                    startTime: clipDef.startTime,
                    endTime: Math.min(clipDef.endTime, video.duration || clipDef.endTime)
                  })

                  newTimeline.push({
                    clipId,
                    transition: clipDef.transition || 'none',
                    transitionDuration: clipDef.transition === 'fade' ? 0.5 : undefined
                  })
                }
              }

              newProject.clips = newClips
              newProject.timeline = newTimeline
            }
            break
          }

        }

        return newProject
      })
    }

    // Handle subtitle style changes
    if (action && action.type === 'setSubtitleStyle' && action.subtitleStyle) {
      setSubtitleStyle(prev => ({
        ...prev,
        ...action.subtitleStyle
      }))
    }

    // Handle global effects from response.effects
    if (response.effects && Object.keys(response.effects).length > 0) {
      setProject(prev => ({
        ...prev,
        globalEffects: { ...prev.globalEffects, ...response.effects }
      }))
    }
  }, [])

  // AI command processing
  const handleAiSubmit = async () => {
    if (!aiPrompt.trim() || aiLoading) return

    const userMessage = aiPrompt.trim()
    setAiMessages(prev => [...prev, { role: 'user', text: userMessage }])
    setAiPrompt('')
    setAiLoading(true)

    // Check if user wants to export
    if (userMessage.match(/出力|エクスポート|書き出|保存|ダウンロード|完成/i)) {
      if (project.timeline.length === 0 && project.videos.length > 0) {
        // Auto-add all videos to timeline if not done yet
        setAiMessages(prev => [...prev, {
          role: 'ai',
          text: 'タイムラインにクリップがありません。まず「動画1を全部使って」などで動画をタイムラインに追加してください。'
        }])
        setAiLoading(false)
        return
      }
      await handleExport()
      setAiLoading(false)
      return
    }

    // Check if no video
    if (project.videos.length === 0 && !userMessage.match(/こんにちは|ヘルプ|help|使い方/i)) {
      setAiMessages(prev => [...prev, {
        role: 'ai',
        text: 'まず動画を追加してください。左下の＋ボタンから動画を選択できます。'
      }])
      setAiLoading(false)
      return
    }

    // Check if user wants subtitles
    if (userMessage.match(/字幕|テロップ|文字起こし|キャプション|subtitle/i)) {
      if (project.videos.length === 0) {
        setAiMessages(prev => [...prev, {
          role: 'ai',
          text: 'まず動画を追加してください。'
        }])
        setAiLoading(false)
        return
      }

      // Handle subtitle style changes
      if (userMessage.match(/大き|サイズ/i)) {
        if (userMessage.match(/大き/i)) {
          setSubtitleStyle(prev => ({ ...prev, fontSize: 'large' }))
          setAiMessages(prev => [...prev, { role: 'ai', text: '字幕を大きくしました。' }])
        } else if (userMessage.match(/小さ/i)) {
          setSubtitleStyle(prev => ({ ...prev, fontSize: 'small' }))
          setAiMessages(prev => [...prev, { role: 'ai', text: '字幕を小さくしました。' }])
        }
        setAiLoading(false)
        return
      }

      if (userMessage.match(/消|削除|非表示|オフ/i)) {
        setSubtitles([])
        setAiMessages(prev => [...prev, { role: 'ai', text: '字幕を削除しました。' }])
        setAiLoading(false)
        return
      }

      // Generate subtitles
      if (subtitles.length > 0 && !userMessage.match(/再生成|やり直|もう一度/i)) {
        setAiMessages(prev => [...prev, {
          role: 'ai',
          text: `字幕は既に生成済みです（${subtitles.length}個のセグメント）。\n再生成する場合は「字幕を再生成して」と言ってください。`
        }])
        setAiLoading(false)
        return
      }

      await handleGenerateSubtitles()
      setAiLoading(false)
      return
    }

    try {
      // Add user message to conversation history
      const updatedHistory: ConversationMessage[] = [
        ...conversationHistory,
        { role: 'user', content: userMessage }
      ]

      // Check if user is requesting auto-edit/scene analysis
      const isAutoEditRequest = userMessage.match(/カット|切っ|お任せ|自動|いい感じに|良い感じに|ハイライト|見どころ|短く|要約|まとめ/i)

      // Extract frames from first video for AI vision
      let frames: string[] | undefined
      let frameTimestampInfo = ''

      if (project.videos.length > 0 && project.videos[0].url) {
        try {
          if (isAutoEditRequest) {
            // Use detailed scene analysis for auto-edit requests
            const sceneData = await extractFramesForSceneAnalysis(project.videos[0].url, 2)
            frames = sceneData.frames.map(f => f.base64)
            frameTimestampInfo = `\n\n【フレームのタイムスタンプ情報】\n${sceneData.frames.map((f, i) => `フレーム${i + 1}: ${f.timestamp.toFixed(1)}秒`).join('\n')}\n動画の長さ: ${sceneData.duration.toFixed(1)}秒\n\nこれらのフレームを分析して、良い部分と不要な部分を判断してください。`
          } else {
            // Use standard frame extraction for other requests
            frames = await extractVideoFrames(project.videos[0].url, 3)
          }
        } catch (frameErr) {
          console.warn('Could not extract frames:', frameErr)
        }
      }

      // Build context for AI
      const projectContext = {
        videoCount: project.videos.length,
        videos: project.videos.map((v, i) => ({
          index: i + 1,
          name: v.name,
          duration: v.duration?.toFixed(1) || 'unknown'
        })),
        timelineClipCount: project.timeline.length,
        timeline: project.timeline.map((t, i) => {
          const clip = project.clips.find(c => c.id === t.clipId)
          const video = clip ? project.videos.find(v => v.id === clip.sourceId) : null
          const videoIndex = video ? project.videos.indexOf(video) + 1 : 0
          return {
            position: i + 1,
            videoIndex,
            startTime: clip?.startTime,
            endTime: clip?.endTime,
            transition: t.transition
          }
        }),
        globalEffects: project.globalEffects
      }

      // Append frame timestamp info for auto-edit requests
      const promptWithContext = frameTimestampInfo
        ? userMessage + frameTimestampInfo
        : userMessage

      const response = await callAI(promptWithContext, DEFAULT_API_KEY, frames, projectContext, updatedHistory)

      processAIResponse(response)

      // Add AI response to conversation history
      setConversationHistory([
        ...updatedHistory,
        { role: 'assistant', content: response.message }
      ])

      // Handle format from message
      if (userMessage.match(/tiktok|ティックトック/i)) setFormat('tiktok')
      else if (userMessage.match(/youtube|ユーチューブ/i)) setFormat('youtube')
      else if (userMessage.match(/正方形|スクエア|square|インスタ/i)) setFormat('square')

      setAiMessages(prev => [...prev, { role: 'ai', text: response.message }])
    } catch (err) {
      console.error('AI processing error:', err)
      setAiMessages(prev => [...prev, {
        role: 'ai',
        text: 'エラーが発生しました。もう一度お試しください。'
      }])
    } finally {
      setAiLoading(false)
    }
  }

  // Canvas-based WYSIWYG export - captures exactly what's shown in preview
  const handleExport = async () => {
    if (project.timeline.length === 0) {
      setAiMessages(prev => [...prev, {
        role: 'ai',
        text: 'タイムラインにクリップがありません。'
      }])
      return
    }

    setIsExporting(true)
    setIsProcessing(true)
    setError(null)
    setExportProgress(0)
    setProgress({ progress: 0, message: 'エクスポート準備中...' })

    try {
      setAiMessages(prev => [...prev, { role: 'ai', text: 'プレビューを録画中...' }])
      // Create offscreen canvas for recording
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!

      // Set canvas size based on format
      const formatSizes: Record<string, { width: number; height: number }> = {
        tiktok: { width: 1080, height: 1920 },
        youtube: { width: 1920, height: 1080 },
        square: { width: 1080, height: 1080 }
      }
      const size = formatSizes[format] || formatSizes.youtube
      canvas.width = size.width
      canvas.height = size.height

      // Create audio context for mixing audio from clips
      const audioContext = new AudioContext()
      const audioDestination = audioContext.createMediaStreamDestination()

      // Setup MediaRecorder - detect best supported mime type
      const canvasStream = canvas.captureStream(30)
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks()
      ])

      // Prefer MP4 (Safari/iOS), fallback to WebM
      let mimeType = 'video/webm;codecs=vp9,opus'
      let isNativeMP4 = false
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E,mp4a.40.2')) {
          mimeType = 'video/mp4;codecs=avc1.42E01E,mp4a.40.2'
          isNativeMP4 = true
        } else if (MediaRecorder.isTypeSupported('video/mp4')) {
          mimeType = 'video/mp4'
          isNativeMP4 = true
        } else if (!MediaRecorder.isTypeSupported(mimeType)) {
          if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) {
            mimeType = 'video/webm;codecs=vp8,opus'
          } else if (MediaRecorder.isTypeSupported('video/webm')) {
            mimeType = 'video/webm'
          }
        }
      }
      console.log('Using MediaRecorder mimeType:', mimeType)

      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: 20000000,
        audioBitsPerSecond: 256000
      })

      const recordedChunks: Blob[] = []
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data)
      }

      // Start recording
      mediaRecorder.start(100)

      // Calculate total duration for progress tracking
      let totalRecordDuration = 0
      for (const item of project.timeline) {
        const clip = project.clips.find(c => c.id === item.clipId)
        if (clip) totalRecordDuration += (clip.endTime - clip.startTime) / (project.globalEffects.speed || 1)
      }

      let elapsedRecordTime = 0

      // Process all clips sequentially
      for (let i = 0; i < project.timeline.length; i++) {
        const timelineItem = project.timeline[i]
        const clip = project.clips.find(c => c.id === timelineItem.clipId)
        if (!clip) continue

        const video = project.videos.find(v => v.id === clip.sourceId)
        if (!video) continue

        const clipDuration = (clip.endTime - clip.startTime) / (project.globalEffects.speed || 1)

        // Record this clip with progress callback
        await recordClipToCanvas(
          video.url,
          clip.startTime,
          clip.endTime,
          canvas,
          ctx,
          project.globalEffects,
          subtitles,
          subtitleStyle,
          audioContext,
          audioDestination,
          project.globalEffects.mute || false,
          (clipProgress) => {
            const overallProgress = ((elapsedRecordTime + clipDuration * clipProgress) / totalRecordDuration) * 80
            setProgress({ progress: Math.round(overallProgress), message: `クリップ${i + 1}を録画中...` })
          }
        )

        elapsedRecordTime += clipDuration
      }

      // Stop recording
      setProgress({ progress: 82, message: '録画完了' })

      await new Promise<void>((resolve) => {
        mediaRecorder.onstop = () => resolve()
        mediaRecorder.stop()
      })

      audioContext.close()

      // Create blob
      const recordedBlob = new Blob(recordedChunks, { type: isNativeMP4 ? 'video/mp4' : 'video/webm' })

      // Convert to MP4 if needed (not needed if already MP4)
      let outputBlob: Blob
      let extension: string

      if (isNativeMP4) {
        // Already MP4, no conversion needed
        outputBlob = recordedBlob
        extension = 'mp4'
        setProgress({ progress: 100, message: '完了!' })
      } else if (isFFmpegSupported()) {
        try {
          setProgress({ progress: 85, message: 'MP4に変換中...' })
          outputBlob = await convertWebMToMP4(recordedBlob, (p) => {
            setProgress({ progress: 85 + Math.round(p.progress * 0.15), message: p.message })
          })
          extension = 'mp4'
        } catch (e) {
          console.warn('MP4 conversion failed, using WebM:', e)
          outputBlob = recordedBlob
          extension = 'webm'
        }
      } else {
        // Fallback: download as WebM
        outputBlob = recordedBlob
        extension = 'webm'
        setProgress({ progress: 100, message: '完了!' })
      }

      // Download - use share API on mobile, fallback to link
      const fileName = `edited_${format}_${Date.now()}.${extension}`
      const url = URL.createObjectURL(outputBlob)

      const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

      if (isMobileDevice && navigator.share) {
        try {
          const file = new File([outputBlob], fileName, { type: outputBlob.type })
          await navigator.share({ files: [file] })
          setAiMessages(prev => [...prev, {
            role: 'ai',
            text: 'エクスポート完了！'
          }])
        } catch (e) {
          // User cancelled share or not supported, fallback to open
          window.open(url, '_blank')
          setAiMessages(prev => [...prev, {
            role: 'ai',
            text: 'エクスポート完了！新しいタブで開きました。長押しで保存してください。'
          }])
        }
      } else {
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setAiMessages(prev => [...prev, {
          role: 'ai',
          text: 'エクスポート完了！ダウンロードが開始されました。'
        }])
      }

      setTimeout(() => URL.revokeObjectURL(url), 1000)

    } catch (err) {
      console.error('Export error:', err)
      setError(err instanceof Error ? err.message : 'エクスポート中にエラーが発生しました')
      setAiMessages(prev => [...prev, {
        role: 'ai',
        text: 'エラーが発生しました: ' + (err instanceof Error ? err.message : '不明なエラー')
      }])
    } finally {
      setIsExporting(false)
      setIsProcessing(false)
      setProgress(null)
      setExportProgress(0)
    }
  }

  // Record a single clip to canvas with audio
  async function recordClipToCanvas(
    videoUrl: string,
    startTime: number,
    endTime: number,
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    effects: VideoEffects,
    subtitleSegments: SubtitleSegment[],
    subStyle: SubtitleStyle,
    audioContext: AudioContext,
    audioDestination: MediaStreamAudioDestinationNode,
    muted: boolean,
    onClipProgress?: (progress: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const renderVideo = document.createElement('video')
      renderVideo.crossOrigin = 'anonymous'
      renderVideo.src = videoUrl
      renderVideo.playsInline = true

      renderVideo.onloadedmetadata = async () => {
        renderVideo.currentTime = startTime

        await new Promise<void>(r => {
          renderVideo.onseeked = () => r()
        })

        // Connect audio
        let audioSource: MediaElementAudioSourceNode | null = null
        if (!muted) {
          try {
            audioSource = audioContext.createMediaElementSource(renderVideo)
            // Apply speed effect to audio if needed
            if (effects.speed && effects.speed !== 1) {
              // Note: Web Audio API doesn't directly support playback rate changes
              // The video.playbackRate will handle this, but audio pitch will change
            }
            audioSource.connect(audioDestination)
          } catch (e) {
            console.warn('Could not connect audio source:', e)
          }
        }

        renderVideo.muted = muted
        renderVideo.playbackRate = effects.speed || 1

        const cssFilter = effectsToCssFilter(effects)
        const duration = endTime - startTime
        const actualDuration = duration / (effects.speed || 1)
        const startRenderTime = performance.now()

        await renderVideo.play()

        const render = () => {
          const elapsed = (performance.now() - startRenderTime) / 1000
          const currentVideoTime = startTime + (elapsed * (effects.speed || 1))

          if (currentVideoTime >= endTime || elapsed >= actualDuration) {
            renderVideo.pause()
            if (audioSource) {
              try { audioSource.disconnect() } catch { /* ignore */ }
            }
            onClipProgress?.(1)
            resolve()
            return
          }

          // Report progress
          onClipProgress?.(elapsed / actualDuration)

          // Clear canvas
          ctx.fillStyle = 'black'
          ctx.fillRect(0, 0, canvas.width, canvas.height)

          // Apply CSS filter
          ctx.filter = cssFilter

          // Calculate video positioning
          const videoAspect = renderVideo.videoWidth / renderVideo.videoHeight
          const canvasAspect = canvas.width / canvas.height

          let drawWidth, drawHeight, drawX, drawY
          if (videoAspect > canvasAspect) {
            drawWidth = canvas.width
            drawHeight = canvas.width / videoAspect
            drawX = 0
            drawY = (canvas.height - drawHeight) / 2
          } else {
            drawHeight = canvas.height
            drawWidth = canvas.height * videoAspect
            drawX = (canvas.width - drawWidth) / 2
            drawY = 0
          }

          // Apply transforms
          ctx.save()
          if (effects.flip) {
            ctx.translate(canvas.width, 0)
            ctx.scale(-1, 1)
          }
          if (effects.rotate) {
            ctx.translate(canvas.width / 2, canvas.height / 2)
            ctx.rotate((effects.rotate * Math.PI) / 180)
            ctx.translate(-canvas.width / 2, -canvas.height / 2)
          }

          ctx.drawImage(renderVideo, drawX, drawY, drawWidth, drawHeight)
          ctx.restore()

          // Reset filter for subtitles
          ctx.filter = 'none'

          // Draw subtitles - position relative to video area, not full canvas
          const currentSub = subtitleSegments.find(s =>
            currentVideoTime >= s.startTime && currentVideoTime <= s.endTime
          )

          if (currentSub) {
            // Font size relative to video height (not canvas height)
            const fontSizes: Record<string, number> = {
              small: Math.round(drawHeight * 0.04),
              medium: Math.round(drawHeight * 0.05),
              large: Math.round(drawHeight * 0.065)
            }
            const fontSize = fontSizes[subStyle.fontSize] || fontSizes.medium

            ctx.font = `bold ${fontSize}px "Noto Sans JP", "Hiragino Sans", sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'

            // Position relative to video area (drawY is top of video, drawHeight is video height)
            let textY: number
            switch (subStyle.position) {
              case 'top': textY = drawY + drawHeight * 0.08; break
              case 'center': textY = drawY + drawHeight * 0.5; break
              default: textY = drawY + drawHeight * 0.90 // bottom, match preview visually
            }

            const metrics = ctx.measureText(currentSub.text)
            const textWidth = metrics.width
            const textHeight = fontSize * 1.4
            const padding = fontSize * 0.3

            if (subStyle.backgroundColor && subStyle.backgroundColor !== 'transparent') {
              ctx.fillStyle = subStyle.backgroundColor
              ctx.fillRect(
                (canvas.width - textWidth) / 2 - padding,
                textY - textHeight / 2,
                textWidth + padding * 2,
                textHeight
              )
            }

            ctx.fillStyle = subStyle.color || '#ffffff'
            ctx.fillText(currentSub.text, canvas.width / 2, textY)
          }

          requestAnimationFrame(render)
        }

        render()
      }

      renderVideo.onerror = () => {
        reject(new Error('Failed to load video'))
      }
    })
  }

  // Generate subtitles using Whisper
  const handleGenerateSubtitles = async () => {
    if (project.videos.length === 0) return

    setIsGeneratingSubtitles(true)
    setSubtitleProgress({ progress: 0, message: '字幕生成を開始...' })
    setAiMessages(prev => [...prev, { role: 'ai', text: '字幕を生成しています...\n（初回はモデルのダウンロードに時間がかかります）' }])

    try {
      const videoUrl = project.videos[0].url
      const segments = await generateSubtitles(
        videoUrl,
        'ja',
        (progress, message) => {
          setSubtitleProgress({ progress, message })
        }
      )

      setSubtitles(segments)
      setSubtitleProgress(null)

      if (segments.length > 0) {
        const previewText = segments.slice(0, 3).map(s =>
          `${Math.floor(s.startTime)}秒: 「${s.text}」`
        ).join('\n')

        setAiMessages(prev => [...prev, {
          role: 'ai',
          text: `字幕を生成しました！（${segments.length}個のセグメント）\n\n${previewText}${segments.length > 3 ? '\n...' : ''}\n\nプレビューに字幕が表示されます。`
        }])
      } else {
        setAiMessages(prev => [...prev, {
          role: 'ai',
          text: '音声が検出できませんでした。動画に音声が含まれているか確認してください。'
        }])
      }
    } catch (err) {
      console.error('Subtitle generation error:', err)
      setSubtitleProgress(null)
      setAiMessages(prev => [...prev, {
        role: 'ai',
        text: '字幕の生成に失敗しました: ' + (err instanceof Error ? err.message : '不明なエラー')
      }])
    } finally {
      setIsGeneratingSubtitles(false)
    }
  }

  // Get timeline summary for display
  const getTimelineSummary = () => {
    if (project.timeline.length === 0) return null

    return project.timeline.map((t, i) => {
      const clip = project.clips.find(c => c.id === t.clipId)
      const video = clip ? project.videos.find(v => v.id === clip.sourceId) : null
      const videoIndex = video ? project.videos.indexOf(video) + 1 : 0
      return {
        position: i + 1,
        videoIndex,
        startTime: clip?.startTime || 0,
        endTime: clip?.endTime || 0,
        transition: t.transition
      }
    })
  }

  if (!isSupported) {
    return (
      <div className="h-[100dvh] bg-[#212121] flex items-center justify-center p-4">
        <div className="bg-[#2a2a2a] rounded-lg p-6 sm:p-8 text-center max-w-sm sm:max-w-md">
          <AlertTriangle className="h-12 w-12 sm:h-16 sm:w-16 mx-auto text-yellow-500 mb-3 sm:mb-4" />
          <h2 className="text-lg sm:text-xl font-bold mb-2 text-white">ブラウザがサポートされていません</h2>
          <p className="text-sm sm:text-base text-gray-400">Chrome、Firefox、またはEdgeの最新版をお使いください。</p>
        </div>
      </div>
    )
  }

  const timelineSummary = getTimelineSummary()
  const previewState = getCurrentPreviewState()
  const currentSubtitle = getCurrentSubtitle(subtitles, currentTime)

  // Get subtitle font size in pixels
  const getSubtitleFontSize = () => {
    switch (subtitleStyle.fontSize) {
      case 'small': return 'text-sm'
      case 'large': return 'text-xl'
      default: return 'text-base'
    }
  }

  return (
    <div className="h-[100dvh] bg-[#212121] text-white flex flex-col overflow-hidden overscroll-none">
      {/* Fixed Preview Panel */}
      <div className="flex-shrink-0 bg-[#1a1a1a] border-b border-[#333] touch-none">
        <div className="max-w-2xl md:max-w-3xl lg:max-w-4xl mx-auto p-2 sm:p-3">
          {/* Video Preview */}
          <div className="relative bg-black rounded-lg overflow-hidden mb-2">
            {project.videos.length === 0 ? (
              <div className="aspect-video flex items-center justify-center text-gray-500">
                <div className="text-center p-4">
                  <Film className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">動画を追加してください</p>
                </div>
              </div>
            ) : project.timeline.length === 0 ? (
              <div className="aspect-video flex items-center justify-center relative">
                <video
                  src={project.videos[0].url}
                  className="max-h-[30vh] sm:max-h-[35vh] w-auto mx-auto"
                  style={{
                    filter: effectsToCssFilter(project.globalEffects),
                    transform: effectsToCssTransform(project.globalEffects),
                  }}
                  muted={isMuted || project.globalEffects.mute}
                  preload="metadata"
                  playsInline
                  autoPlay={false}
                  onLoadedMetadata={(e) => {
                    // Show first frame
                    const video = e.currentTarget
                    video.currentTime = 0.1
                  }}
                />
                <div className="absolute bottom-2 left-2 text-xs text-gray-400 bg-black/50 px-2 py-1 rounded">
                  タイムラインに追加してください
                </div>
              </div>
            ) : (
              <div className="aspect-video flex items-center justify-center relative">
                <video
                  ref={previewVideoRef}
                  src={previewState?.video?.url || project.videos[0].url}
                  className="max-h-[30vh] sm:max-h-[35vh] w-auto mx-auto"
                  style={{
                    filter: effectsToCssFilter(project.globalEffects),
                    transform: effectsToCssTransform(project.globalEffects),
                  }}
                  muted={isMuted || project.globalEffects.mute}
                  preload="metadata"
                  playsInline
                  onLoadedMetadata={(e) => {
                    // Show first frame
                    const video = e.currentTarget
                    if (!isPlaying) {
                      video.currentTime = 0.1
                    }
                  }}
                />
                {/* Vignette overlay */}
                {project.globalEffects.vignette && project.globalEffects.vignette > 0 && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      boxShadow: `inset 0 0 ${50 + project.globalEffects.vignette * 100}px ${20 + project.globalEffects.vignette * 40}px rgba(0,0,0,${0.3 + project.globalEffects.vignette * 0.5})`,
                    }}
                  />
                )}
                {/* Subtitle overlay */}
                {currentSubtitle && (
                  <div
                    className={`absolute left-0 right-0 flex justify-center pointer-events-none px-4 ${
                      subtitleStyle.position === 'top' ? 'top-[8%]' :
                      subtitleStyle.position === 'center' ? 'top-1/2 -translate-y-1/2' :
                      'top-[78%] -translate-y-1/2'
                    }`}
                  >
                    <span
                      className={`${getSubtitleFontSize()} px-3 py-1.5 rounded font-medium text-center max-w-[90%]`}
                      style={{
                        color: subtitleStyle.color,
                        backgroundColor: subtitleStyle.backgroundColor,
                      }}
                    >
                      {currentSubtitle.text}
                    </span>
                  </div>
                )}
                {/* Current clip indicator */}
                <div className="absolute top-2 left-2 text-xs bg-black/70 px-2 py-1 rounded">
                  クリップ {activeClipIndex + 1}/{project.timeline.length}
                </div>
                {/* Subtitle indicator */}
                {subtitles.length > 0 && (
                  <div className="absolute top-2 right-2 text-xs bg-blue-600/70 px-2 py-1 rounded">
                    字幕ON
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Playback Controls */}
          {project.timeline.length > 0 && (
            <div className="space-y-2">
              {/* Timeline Bar */}
              <div className="relative h-3">
                {/* Bar background */}
                <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  {/* Clip color segments */}
                  {(() => {
                    let accumulated = 0
                    return project.timeline.map((item, i) => {
                      const clip = project.clips.find(c => c.id === item.clipId)
                      if (!clip) return null
                      const clipDuration = (clip.endTime - clip.startTime) / (project.globalEffects.speed || 1)
                      const widthPercent = (clipDuration / totalDuration) * 100
                      const leftPercent = (accumulated / totalDuration) * 100
                      accumulated += clipDuration
                      const colors = ['bg-blue-500/40', 'bg-green-500/40', 'bg-purple-500/40', 'bg-orange-500/40']
                      return (
                        <div
                          key={i}
                          className={`absolute h-full ${colors[i % colors.length]}`}
                          style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
                        />
                      )
                    })
                  })()}
                  {/* Progress bar */}
                  <div
                    className="absolute top-0 left-0 h-full bg-blue-500 rounded-full"
                    style={{ width: `${totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0}%` }}
                  />
                </div>
                {/* Seek input (overlaid) */}
                <input
                  type="range"
                  min="0"
                  max={totalDuration || 1}
                  step="0.1"
                  value={currentTime}
                  onChange={handleSeek}
                  className="absolute top-0 left-0 w-full h-full appearance-none bg-transparent cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:bg-transparent"
                />
              </div>

              {/* Controls */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRestart}
                    className="p-1.5 hover:bg-white/10 rounded-full transition-colors"
                  >
                    <SkipBack className="h-4 w-4" />
                  </button>
                  <button
                    onClick={handlePlayPause}
                    className="p-2 bg-white text-black rounded-full hover:bg-gray-200 transition-colors"
                  >
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
                  </button>
                  <button
                    onClick={() => setIsMuted(!isMuted)}
                    className="p-1.5 hover:bg-white/10 rounded-full transition-colors"
                  >
                    {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </button>
                </div>
                <div className="text-xs text-gray-400">
                  {formatTime(currentTime)} / {formatTime(totalDuration)}
                </div>
                <div className="flex items-center gap-2">
                  {project.globalEffects.speed && project.globalEffects.speed !== 1 && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-600/30 text-blue-300">
                      {project.globalEffects.speed}x
                    </span>
                  )}
                  {project.videos.length > 0 && (
                    <span className="text-xs text-gray-500">
                      {project.videos.length}本
                    </span>
                  )}
                  <Button
                    onClick={handleExport}
                    size="sm"
                    disabled={isExporting || isProcessing || project.timeline.length === 0}
                    className="bg-green-600 hover:bg-green-700 h-7 text-xs px-2 disabled:opacity-50"
                  >
                    {isExporting ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        処理中
                      </>
                    ) : (
                      <>
                        <Download className="h-3 w-3 mr-1" />
                        保存
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Timeline Clips Summary */}
              <div className="flex flex-wrap gap-1">
                {timelineSummary?.map((item, i) => (
                  <div key={i} className="flex items-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                      i === activeClipIndex
                        ? 'bg-blue-600 text-white'
                        : 'bg-blue-600/30 text-blue-300'
                    }`}>
                      動画{item.videoIndex} ({item.startTime.toFixed(1)}s-{item.endTime.toFixed(1)}s)
                    </span>
                    {i < (timelineSummary?.length || 0) - 1 && (
                      <span className="text-gray-500 mx-1 text-[10px]">
                        {item.transition === 'fade' ? '⟿' : '→'}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Active Effects */}
              {Object.keys(project.globalEffects).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {project.globalEffects.preset && project.globalEffects.preset !== 'none' && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-600/30 text-indigo-300">
                      {getPresetName(project.globalEffects.preset)}
                    </span>
                  )}
                  {project.globalEffects.brightness !== undefined && project.globalEffects.brightness !== 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-yellow-600/30 text-yellow-300">
                      明るさ {project.globalEffects.brightness > 0 ? '+' : ''}{Math.round(project.globalEffects.brightness * 100)}%
                    </span>
                  )}
                  {project.globalEffects.contrast !== undefined && project.globalEffects.contrast !== 1 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-orange-600/30 text-orange-300">
                      コントラスト {Math.round(project.globalEffects.contrast * 100)}%
                    </span>
                  )}
                  {project.globalEffects.saturation !== undefined && project.globalEffects.saturation !== 1 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-pink-600/30 text-pink-300">
                      彩度 {Math.round(project.globalEffects.saturation * 100)}%
                    </span>
                  )}
                  {project.globalEffects.blur && project.globalEffects.blur > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-600/30 text-gray-300">
                      ぼかし {project.globalEffects.blur}px
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto touch-pan-y">
        <div className="max-w-2xl md:max-w-3xl lg:max-w-4xl mx-auto p-3 sm:p-4 md:p-6 space-y-3 sm:space-y-4">
          {aiMessages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[90%] sm:max-w-[85%] md:max-w-[75%]`}>
                {msg.text && (
                  <div className={`rounded-2xl px-3 sm:px-4 py-2 text-sm sm:text-base ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-[#2f2f2f] text-gray-200'
                  }`}>
                    <pre className="whitespace-pre-wrap font-sans">{msg.text}</pre>
                  </div>
                )}
                {msg.video?.isOutput && (
                  <div className={`mt-2 rounded-xl overflow-hidden bg-black ${msg.text ? 'mt-2' : ''}`}>
                    <div className="relative">
                      <video
                        src={msg.video.url}
                        controls
                        className="w-full max-w-[320px] sm:max-w-md md:max-w-lg lg:max-w-xl"
                      />
                    </div>
                    <div className="flex items-center justify-between px-2 sm:px-3 py-1.5 sm:py-2 bg-[#1a1a1a]">
                      <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs text-gray-400">
                        <Film className="h-3 w-3 sm:h-4 sm:w-4" />
                        <span>出力動画</span>
                      </div>
                      <Button
                        onClick={() => handleDownload(msg.video!.url)}
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 h-6 sm:h-7 md:h-8 text-[10px] sm:text-xs px-2 sm:px-3"
                      >
                        <Download className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                        保存
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {aiLoading && (
            <div className="flex justify-start">
              <div className="bg-[#2f2f2f] rounded-2xl px-3 sm:px-4 py-2 text-sm sm:text-base text-gray-400 flex items-center gap-2">
                <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" />
                考え中...
              </div>
            </div>
          )}

          {progress && (
            <div className="flex justify-start">
              <div className="bg-[#2f2f2f] rounded-2xl px-3 sm:px-4 py-2 sm:py-3 min-w-[180px] sm:min-w-[220px] md:min-w-[280px]">
                <div className="flex items-center justify-between text-xs sm:text-sm text-gray-300 mb-2">
                  <span>{progress.message}</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-1.5 sm:h-2">
                  <div
                    className="h-1.5 sm:h-2 rounded-full bg-blue-500 transition-all"
                    style={{ width: `${progress.progress}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {subtitleProgress && (
            <div className="flex justify-start">
              <div className="bg-[#2f2f2f] rounded-2xl px-3 sm:px-4 py-2 sm:py-3">
                <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-300">
                  <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                  <span>{subtitleProgress.message}</span>
                </div>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="flex-shrink-0 border-t border-[#333] touch-none">
        <div className="max-w-2xl md:max-w-3xl lg:max-w-4xl mx-auto p-2 sm:p-3 md:p-4">
          <div className="bg-[#2f2f2f] rounded-2xl px-3 sm:px-4 py-2 sm:py-3">
            <input
              ref={inputRef}
              type="text"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleAiSubmit()}
              placeholder="メッセージを入力..."
              disabled={aiLoading || isProcessing}
              className="w-full bg-transparent text-sm sm:text-base text-white placeholder-gray-500 focus:outline-none disabled:opacity-50 mb-2"
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  onClick={handleAddClick}
                  disabled={isProcessing}
                  className="text-gray-400 hover:text-white p-1.5 sm:p-2 disabled:opacity-50 hover:bg-[#404040] rounded-full transition-colors"
                >
                  <Plus className="h-5 w-5 sm:h-6 sm:w-6" />
                </button>
                {project.videos.length > 0 && (
                  <span className="text-[10px] sm:text-xs text-gray-500">
                    {project.videos.length}本の動画
                  </span>
                )}
              </div>
              <Button
                onClick={handleAiSubmit}
                size="sm"
                disabled={aiLoading || isProcessing || !aiPrompt.trim()}
                className="bg-white hover:bg-gray-200 text-black disabled:opacity-30 rounded-full h-8 w-8 sm:h-9 sm:w-9 p-0"
              >
                <Send className="h-4 w-4 sm:h-5 sm:w-5" />
              </Button>
            </div>
          </div>
          {error && (
            <p className="text-red-400 text-xs sm:text-sm mt-2 text-center">{error}</p>
          )}
        </div>
      </div>
    </div>
  )
}
