'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { VideoFormat } from '@/schemas/video'
import { Upload, Download, Loader2, CheckCircle, XCircle, AlertTriangle, Play, Pause, Scissors, RotateCcw } from 'lucide-react'
import { processVideo, isFFmpegSupported, type ProcessingProgress } from '@/lib/ffmpeg'

const MAX_FILE_SIZE_MB = 200
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024

export function VideoEditor() {
  const [format, setFormat] = useState<VideoFormat>('tiktok')
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState<ProcessingProgress | null>(null)
  const [outputUrl, setOutputUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [isSupported, setIsSupported] = useState(true)

  // Video preview states
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)

  const videoRef = useRef<HTMLVideoElement>(null)

  const formats: { value: VideoFormat; label: string; aspect: string }[] = [
    { value: 'tiktok', label: 'TikTok', aspect: '9:16' },
    { value: 'youtube', label: 'YouTube', aspect: '16:9' },
    { value: 'square', label: 'Square', aspect: '1:1' },
    { value: 'landscape', label: 'Landscape', aspect: '16:9' },
  ]

  useEffect(() => {
    setIsSupported(isFFmpegSupported())
  }, [])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 100)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
  }

  const validateAndSetFile = useCallback((selectedFile: File) => {
    setFileError(null)
    setError(null)
    setOutputUrl(null)

    if (!selectedFile.type.startsWith('video/')) {
      setFileError('動画ファイルのみアップロードできます')
      return
    }

    if (selectedFile.size > MAX_FILE_SIZE) {
      setFileError(`ファイルサイズは${MAX_FILE_SIZE_MB}MB以下にしてください`)
      return
    }

    setFile(selectedFile)

    // Create preview URL
    const url = URL.createObjectURL(selectedFile)
    setPreviewUrl(url)
  }, [])

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files?.[0]) {
      validateAndSetFile(e.dataTransfer.files[0])
    }
  }, [validateAndSetFile])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      validateAndSetFile(selectedFile)
    }
  }

  const handleVideoLoaded = () => {
    if (videoRef.current) {
      const dur = videoRef.current.duration
      setDuration(dur)
      setTrimEnd(dur)
    }
  }

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime)
    }
  }

  const togglePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause()
      } else {
        videoRef.current.play()
      }
      setIsPlaying(!isPlaying)
    }
  }

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (videoRef.current && duration > 0) {
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const percentage = x / rect.width
      const newTime = percentage * duration
      videoRef.current.currentTime = newTime
      setCurrentTime(newTime)
    }
  }

  const setTrimStartToCurrent = () => {
    setTrimStart(currentTime)
  }

  const setTrimEndToCurrent = () => {
    setTrimEnd(currentTime)
  }

  const handleSubmit = async () => {
    if (!file) return

    setIsProcessing(true)
    setError(null)
    setOutputUrl(null)
    setProgress({ progress: 0, message: '準備中...' })

    try {
      const outputBlob = await processVideo(
        file,
        format,
        (p) => setProgress(p),
        trimStart,
        trimEnd
      )

      const url = URL.createObjectURL(outputBlob)
      setOutputUrl(url)
      setProgress({ progress: 100, message: '完了!' })
    } catch (err) {
      console.error('Processing error:', err)
      setError(err instanceof Error ? err.message : '処理中にエラーが発生しました')
      setProgress(null)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReset = () => {
    if (outputUrl) {
      URL.revokeObjectURL(outputUrl)
    }
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }
    setFile(null)
    setFileError(null)
    setProgress(null)
    setOutputUrl(null)
    setError(null)
    setIsProcessing(false)
    setPreviewUrl(null)
    setCurrentTime(0)
    setDuration(0)
    setTrimStart(0)
    setTrimEnd(0)
    setIsPlaying(false)
  }

  const handleDownload = () => {
    if (!outputUrl) return

    const a = document.createElement('a')
    a.href = outputUrl
    a.download = `edited_${format}_${Date.now()}.mp4`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  if (!isSupported) {
    return (
      <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center p-4">
        <div className="bg-[#2a2a2a] rounded-lg p-8 text-center max-w-md">
          <AlertTriangle className="h-16 w-16 mx-auto text-yellow-500 mb-4" />
          <h2 className="text-xl font-bold mb-2 text-white">ブラウザがサポートされていません</h2>
          <p className="text-gray-400">
            このアプリはSharedArrayBufferが必要です。
            Chrome、Firefox、またはEdgeの最新版をお使いください。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#1a1a1a] text-white flex flex-col">
      {/* Header */}
      <header className="bg-[#0d0d0d] border-b border-[#333] px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-white">Video Editor</h1>
          {file && (
            <span className="text-sm text-gray-400">{file.name}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {file && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="text-gray-400 hover:text-white hover:bg-[#333]"
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              リセット
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 flex flex-col">
        {/* Main Content */}
        <div className="flex-1 flex">
          {/* Left Panel - Media Pool */}
          <div className="w-64 bg-[#1f1f1f] border-r border-[#333] p-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase mb-3">メディア</h2>

            {!file ? (
              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer
                  ${dragActive ? 'border-blue-500 bg-blue-500/10' : 'border-[#444] hover:border-[#555]'}
                  ${fileError ? 'border-red-500 bg-red-500/10' : ''}`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleFileChange}
                  className="hidden"
                  id="video-upload"
                  disabled={isProcessing}
                />
                <label htmlFor="video-upload" className="cursor-pointer">
                  <Upload className="h-8 w-8 mx-auto text-gray-500 mb-2" />
                  <p className="text-sm text-gray-400">動画をドロップ</p>
                  <p className="text-xs text-gray-500 mt-1">最大{MAX_FILE_SIZE_MB}MB</p>
                </label>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-[#2a2a2a] rounded p-2">
                  <div className="aspect-video bg-black rounded overflow-hidden mb-2">
                    {previewUrl && (
                      <video src={previewUrl} className="w-full h-full object-contain" />
                    )}
                  </div>
                  <p className="text-xs text-gray-400 truncate">{file.name}</p>
                  <p className="text-xs text-gray-500">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                </div>
              </div>
            )}

            {fileError && (
              <p className="text-xs text-red-400 mt-2 flex items-center gap-1">
                <XCircle className="h-3 w-3" />
                {fileError}
              </p>
            )}
          </div>

          {/* Center - Preview */}
          <div className="flex-1 bg-[#0d0d0d] flex flex-col">
            <div className="flex-1 flex items-center justify-center p-4">
              {previewUrl ? (
                <video
                  ref={videoRef}
                  src={previewUrl}
                  className="max-w-full max-h-full rounded"
                  onLoadedMetadata={handleVideoLoaded}
                  onTimeUpdate={handleTimeUpdate}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                />
              ) : outputUrl ? (
                <video
                  src={outputUrl}
                  controls
                  className="max-w-full max-h-full rounded"
                />
              ) : (
                <div className="text-gray-500 text-center">
                  <Upload className="h-16 w-16 mx-auto mb-4 opacity-50" />
                  <p>動画をアップロードしてください</p>
                </div>
              )}
            </div>

            {/* Playback Controls */}
            {previewUrl && (
              <div className="bg-[#1a1a1a] border-t border-[#333] p-3">
                <div className="flex items-center justify-center gap-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={togglePlayPause}
                    className="text-white hover:bg-[#333]"
                  >
                    {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                  </Button>
                  <span className="text-sm font-mono text-gray-400">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Right Panel - Settings */}
          <div className="w-72 bg-[#1f1f1f] border-l border-[#333] p-3 overflow-y-auto">
            <h2 className="text-xs font-semibold text-gray-400 uppercase mb-3">設定</h2>

            {/* Format Selection */}
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-2">出力フォーマット</label>
              <div className="grid grid-cols-2 gap-1">
                {formats.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => setFormat(f.value)}
                    disabled={isProcessing}
                    className={`px-3 py-2 rounded text-xs font-medium transition-colors
                      ${format === f.value
                        ? 'bg-blue-600 text-white'
                        : 'bg-[#2a2a2a] text-gray-300 hover:bg-[#333]'}`}
                  >
                    {f.label}
                    <span className="block text-[10px] opacity-70">{f.aspect}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Trim Controls */}
            {previewUrl && duration > 0 && (
              <div className="mb-4">
                <label className="block text-xs text-gray-400 mb-2">
                  <Scissors className="h-3 w-3 inline mr-1" />
                  トリミング
                </label>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-12">開始</span>
                    <div className="flex-1 bg-[#2a2a2a] rounded px-2 py-1">
                      <span className="text-xs font-mono">{formatTime(trimStart)}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={setTrimStartToCurrent}
                      className="text-xs text-blue-400 hover:text-blue-300 hover:bg-[#333] px-2 h-7"
                    >
                      現在位置
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-12">終了</span>
                    <div className="flex-1 bg-[#2a2a2a] rounded px-2 py-1">
                      <span className="text-xs font-mono">{formatTime(trimEnd)}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={setTrimEndToCurrent}
                      className="text-xs text-blue-400 hover:text-blue-300 hover:bg-[#333] px-2 h-7"
                    >
                      現在位置
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Progress */}
            {progress && (
              <div className="mb-4 p-3 rounded bg-[#2a2a2a]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-400">{progress.message}</span>
                  <span className="text-xs text-gray-500">{progress.progress}%</span>
                </div>
                <div className="w-full bg-[#1a1a1a] rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      error ? 'bg-red-500' :
                      progress.progress === 100 ? 'bg-green-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${progress.progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded">
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <XCircle className="h-3 w-3" />
                  {error}
                </p>
              </div>
            )}

            {/* Export Button */}
            <Button
              onClick={handleSubmit}
              disabled={!file || isProcessing}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  処理中...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  エクスポート
                </>
              )}
            </Button>

            {/* Download Button */}
            {outputUrl && (
              <div className="mt-4 p-3 bg-green-500/10 border border-green-500/30 rounded">
                <p className="text-xs text-green-400 flex items-center gap-1 mb-2">
                  <CheckCircle className="h-3 w-3" />
                  変換完了!
                </p>
                <Button
                  onClick={handleDownload}
                  className="w-full bg-green-600 hover:bg-green-700 text-white"
                  size="sm"
                >
                  <Download className="h-4 w-4 mr-2" />
                  ダウンロード
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Timeline */}
        {previewUrl && duration > 0 && (
          <div className="h-32 bg-[#1f1f1f] border-t border-[#333]">
            {/* Time ruler */}
            <div className="h-6 bg-[#1a1a1a] border-b border-[#333] px-2 flex items-center">
              <div className="flex-1 relative">
                {Array.from({ length: Math.ceil(duration) + 1 }).map((_, i) => (
                  <span
                    key={i}
                    className="absolute text-[10px] text-gray-500"
                    style={{ left: `${(i / duration) * 100}%`, transform: 'translateX(-50%)' }}
                  >
                    {formatTime(i)}
                  </span>
                ))}
              </div>
            </div>

            {/* Timeline track */}
            <div className="p-2">
              <div
                className="relative h-16 bg-[#2a2a2a] rounded cursor-pointer"
                onClick={handleTimelineClick}
              >
                {/* Trim region */}
                <div
                  className="absolute top-0 bottom-0 bg-blue-500/20 border-x-2 border-blue-500"
                  style={{
                    left: `${(trimStart / duration) * 100}%`,
                    width: `${((trimEnd - trimStart) / duration) * 100}%`,
                  }}
                />

                {/* Video track visualization */}
                <div
                  className="absolute top-2 bottom-2 left-0 right-0 bg-gradient-to-r from-blue-600 to-purple-600 rounded opacity-60"
                  style={{
                    left: `${(trimStart / duration) * 100}%`,
                    width: `${((trimEnd - trimStart) / duration) * 100}%`,
                  }}
                />

                {/* Playhead */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
                  style={{ left: `${(currentTime / duration) * 100}%` }}
                >
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-red-500 rotate-45" />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
