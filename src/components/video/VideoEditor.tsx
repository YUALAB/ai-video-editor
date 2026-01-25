'use client'

import { useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { VideoFormat } from '@/schemas/video'
import { Upload, Wand2, Download, Loader2, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'
import { processVideo, isFFmpegSupported, type ProcessingProgress } from '@/lib/ffmpeg'

const MAX_FILE_SIZE_MB = 200
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024

export function VideoEditor() {
  const [prompt, setPrompt] = useState('')
  const [format, setFormat] = useState<VideoFormat>('tiktok')
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState<ProcessingProgress | null>(null)
  const [outputUrl, setOutputUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [isSupported, setIsSupported] = useState(true)

  const formats: { value: VideoFormat; label: string; aspect: string }[] = [
    { value: 'tiktok', label: 'TikTok', aspect: '9:16' },
    { value: 'youtube', label: 'YouTube', aspect: '16:9' },
    { value: 'square', label: 'Square', aspect: '1:1' },
    { value: 'landscape', label: 'Landscape', aspect: '16:9' },
  ]

  useEffect(() => {
    setIsSupported(isFFmpegSupported())
  }, [])

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
        (p) => setProgress(p)
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
    setFile(null)
    setFileError(null)
    setPrompt('')
    setProgress(null)
    setOutputUrl(null)
    setError(null)
    setIsProcessing(false)
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
      <div className="container mx-auto p-4 max-w-4xl">
        <Card className="shadow-lg">
          <CardContent className="p-8 text-center">
            <AlertTriangle className="h-16 w-16 mx-auto text-yellow-500 mb-4" />
            <h2 className="text-xl font-bold mb-2">ブラウザがサポートされていません</h2>
            <p className="text-gray-600">
              このアプリはSharedArrayBufferが必要です。
              Chrome、Firefox、またはEdgeの最新版をお使いください。
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <Card className="shadow-lg">
        <CardHeader className="bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-t-lg">
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Wand2 className="h-7 w-7" />
            AI Video Editor
          </CardTitle>
          <CardDescription className="text-purple-100">
            動画をアップロードして、フォーマットを選択してください
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          {/* File Upload */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors
              ${dragActive ? 'border-purple-500 bg-purple-50' : 'border-gray-300 hover:border-gray-400'}
              ${file ? 'bg-green-50 border-green-300' : ''}
              ${fileError ? 'bg-red-50 border-red-300' : ''}`}
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
              {file ? (
                <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-4" />
              ) : (
                <Upload className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              )}
              <p className="text-lg font-medium">
                {file ? file.name : '動画をアップロード'}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                {file
                  ? `${(file.size / 1024 / 1024).toFixed(2)} MB`
                  : `クリックまたはドラッグ＆ドロップ（最大${MAX_FILE_SIZE_MB}MB）`}
              </p>
              {fileError && (
                <p className="text-sm text-red-600 mt-2 flex items-center justify-center gap-1">
                  <XCircle className="h-4 w-4" />
                  {fileError}
                </p>
              )}
            </label>
          </div>

          {/* Format Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">出力フォーマット</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {formats.map((f) => (
                <Button
                  key={f.value}
                  variant={format === f.value ? 'default' : 'outline'}
                  onClick={() => setFormat(f.value)}
                  disabled={isProcessing}
                  className={format === f.value ? 'bg-purple-600 hover:bg-purple-700' : ''}
                >
                  <span className="font-medium">{f.label}</span>
                  <span className="text-xs ml-1 opacity-70">({f.aspect})</span>
                </Button>
              ))}
            </div>
          </div>

          {/* Prompt Input (for future AI features) */}
          <div>
            <label className="block text-sm font-medium mb-2">編集指示（オプション）</label>
            <Textarea
              placeholder="例: 明るくして、テキストを追加して（将来のAI機能用）"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              disabled={isProcessing}
              className="resize-none"
            />
            <p className="text-xs text-gray-500 mt-1">
              現在はフォーマット変換のみ対応。AI編集機能は近日公開予定。
            </p>
          </div>

          {/* Progress */}
          {progress && (
            <div className="p-4 rounded-lg bg-gray-50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{progress.message}</span>
                <span className="text-sm text-gray-500">{progress.progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${
                    error ? 'bg-red-500' :
                    progress.progress === 100 ? 'bg-green-500' : 'bg-purple-600'
                  }`}
                  style={{ width: `${progress.progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 flex items-center gap-2">
                <XCircle className="h-5 w-5" />
                {error}
              </p>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3">
            <Button
              onClick={handleSubmit}
              disabled={!file || isProcessing}
              className="flex-1 bg-purple-600 hover:bg-purple-700"
              size="lg"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  処理中...
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4 mr-2" />
                  変換する
                </>
              )}
            </Button>
            {(file || outputUrl) && (
              <Button
                variant="outline"
                onClick={handleReset}
                disabled={isProcessing}
              >
                リセット
              </Button>
            )}
          </div>

          {/* Output */}
          {outputUrl && (
            <div className="mt-6 p-4 bg-green-50 rounded-lg border border-green-200">
              <p className="text-green-800 font-medium mb-3 flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                変換完了!
              </p>
              <video
                src={outputUrl}
                controls
                className="w-full max-h-64 rounded-lg mb-3 bg-black"
              />
              <Button
                onClick={handleDownload}
                className="bg-green-600 hover:bg-green-700"
              >
                <Download className="h-4 w-4 mr-2" />
                ダウンロード
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Features */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
        <Card className="p-4">
          <h3 className="font-semibold mb-2">🎬 ブラウザ内処理</h3>
          <p className="text-sm text-gray-600">
            サーバー不要！あなたのブラウザで直接処理
          </p>
        </Card>
        <Card className="p-4">
          <h3 className="font-semibold mb-2">🔒 プライバシー保護</h3>
          <p className="text-sm text-gray-600">
            動画はあなたのデバイスから出ません
          </p>
        </Card>
        <Card className="p-4">
          <h3 className="font-semibold mb-2">📱 マルチフォーマット</h3>
          <p className="text-sm text-gray-600">
            TikTok、YouTube、Instagramなどに対応
          </p>
        </Card>
      </div>
    </div>
  )
}
