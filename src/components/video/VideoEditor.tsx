'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { VideoFormat } from '@/schemas/video'
import { Upload, Wand2, Download, Loader2, CheckCircle, XCircle } from 'lucide-react'

interface JobStatus {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  output_url?: string
  error?: string
}

const MAX_FILE_SIZE_MB = 500
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024

export function VideoEditor() {
  const [prompt, setPrompt] = useState('')
  const [format, setFormat] = useState<VideoFormat>('tiktok')
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [backendError, setBackendError] = useState<string | null>(null)

  const formats: { value: VideoFormat; label: string; aspect: string }[] = [
    { value: 'tiktok', label: 'TikTok', aspect: '9:16' },
    { value: 'youtube', label: 'YouTube', aspect: '16:9' },
    { value: 'square', label: 'Square', aspect: '1:1' },
    { value: 'landscape', label: 'Landscape', aspect: '16:9' },
  ]

  // Poll for job status
  useEffect(() => {
    if (!jobId || jobStatus?.status === 'completed' || jobStatus?.status === 'failed') {
      return
    }

    const interval = setInterval(async () => {
      try {
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || ''
        const response = await fetch(`${backendUrl}/api/status/${jobId}`)
        if (response.ok) {
          const data = await response.json() as JobStatus
          setJobStatus(data)
          if (data.status === 'completed' || data.status === 'failed') {
            setIsProcessing(false)
          }
        }
      } catch (error) {
        console.error('Error polling status:', error)
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [jobId, jobStatus?.status])

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const validateAndSetFile = useCallback((selectedFile: File) => {
    setFileError(null)

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
    if (!prompt || !file) return

    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL

    if (!backendUrl) {
      setBackendError('バックエンドサーバーが設定されていません。管理者にお問い合わせください。')
      return
    }

    setIsProcessing(true)
    setJobStatus(null)
    setBackendError(null)

    try {
      const formData = new FormData()
      formData.append('prompt', prompt)
      formData.append('format', format)
      formData.append('video', file)

      const response = await fetch(`${backendUrl}/api/edit`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        let errorMessage = 'サーバーエラーが発生しました'

        if (response.status === 413) {
          errorMessage = 'ファイルサイズが大きすぎます'
        } else if (response.status === 429) {
          errorMessage = 'リクエストが多すぎます。しばらく待ってから再試行してください'
        } else {
          try {
            const errorData = await response.json()
            errorMessage = errorData.error || errorData.detail || errorMessage
          } catch {
            // Response is not JSON, use default message
          }
        }

        throw new Error(errorMessage)
      }

      const data = await response.json() as { id: string }
      setJobId(data.id)
      setJobStatus({ id: data.id, status: 'pending', progress: 0 })
    } catch (error) {
      console.error('Error:', error)
      setIsProcessing(false)
      setJobStatus({
        id: '',
        status: 'failed',
        progress: 0,
        error: error instanceof Error ? error.message : '処理を開始できませんでした'
      })
    }
  }

  const handleReset = () => {
    setFile(null)
    setFileError(null)
    setPrompt('')
    setJobId(null)
    setJobStatus(null)
    setIsProcessing(false)
    setBackendError(null)
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
            動画をアップロードして、AIに編集を指示してください
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
                  : 'クリックまたはドラッグ＆ドロップ'}
              </p>
              {fileError && (
                <p className="text-sm text-red-600 mt-2 flex items-center justify-center gap-1">
                  <XCircle className="h-4 w-4" />
                  {fileError}
                </p>
              )}
            </label>
          </div>

          {/* Backend Error */}
          {backendError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 flex items-center gap-2">
                <XCircle className="h-5 w-5" />
                {backendError}
              </p>
            </div>
          )}

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

          {/* Prompt Input */}
          <div>
            <label className="block text-sm font-medium mb-2">編集指示</label>
            <Textarea
              placeholder="例: 最初の10秒をカットして、テキスト「こんにちは」を中央に追加して、BGMを入れて"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              disabled={isProcessing}
              className="resize-none"
            />
            <p className="text-xs text-gray-500 mt-1">
              具体的な指示を書くほど、より正確な結果が得られます
            </p>
          </div>

          {/* Progress */}
          {jobStatus && (
            <div className="p-4 rounded-lg bg-gray-50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">
                  {jobStatus.status === 'pending' && '準備中...'}
                  {jobStatus.status === 'processing' && '処理中...'}
                  {jobStatus.status === 'completed' && '完了！'}
                  {jobStatus.status === 'failed' && 'エラー'}
                </span>
                <span className="text-sm text-gray-500">{jobStatus.progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${
                    jobStatus.status === 'failed' ? 'bg-red-500' :
                    jobStatus.status === 'completed' ? 'bg-green-500' : 'bg-purple-600'
                  }`}
                  style={{ width: `${jobStatus.progress}%` }}
                />
              </div>
              {jobStatus.error && (
                <p className="text-red-600 text-sm mt-2 flex items-center gap-1">
                  <XCircle className="h-4 w-4" />
                  {jobStatus.error}
                </p>
              )}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3">
            <Button
              onClick={handleSubmit}
              disabled={!prompt || !file || isProcessing}
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
                  AIで編集する
                </>
              )}
            </Button>
            {(jobStatus || file) && (
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
          {jobStatus?.status === 'completed' && jobStatus.output_url && (
            <div className="mt-6 p-4 bg-green-50 rounded-lg border border-green-200">
              <p className="text-green-800 font-medium mb-3 flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                編集完了！
              </p>
              <Button asChild className="bg-green-600 hover:bg-green-700">
                <a href={jobStatus.output_url} download>
                  <Download className="h-4 w-4 mr-2" />
                  ダウンロード
                </a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Features */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
        <Card className="p-4">
          <h3 className="font-semibold mb-2">🎬 動画理解</h3>
          <p className="text-sm text-gray-600">
            AIが動画の内容を分析して、最適な編集を提案
          </p>
        </Card>
        <Card className="p-4">
          <h3 className="font-semibold mb-2">✨ 自然言語指示</h3>
          <p className="text-sm text-gray-600">
            「面白いところだけ切り抜いて」など自然な日本語でOK
          </p>
        </Card>
        <Card className="p-4">
          <h3 className="font-semibold mb-2">📱 マルチフォーマット</h3>
          <p className="text-sm text-gray-600">
            TikTok、YouTube、Instagramなど各プラットフォームに対応
          </p>
        </Card>
      </div>
    </div>
  )
}
