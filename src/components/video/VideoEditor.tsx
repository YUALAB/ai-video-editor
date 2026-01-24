'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { VideoFormat, VideoFormatSchema } from '@/schemas/video'
import { Upload, Wand2, Download, Loader2 } from 'lucide-react'

export function VideoEditor() {
  const [prompt, setPrompt] = useState('')
  const [format, setFormat] = useState<VideoFormat>('tiktok')
  const [file, setFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [outputUrl, setOutputUrl] = useState<string | null>(null)

  const formats: { value: VideoFormat; label: string; aspect: string }[] = [
    { value: 'tiktok', label: 'TikTok', aspect: '9:16' },
    { value: 'youtube', label: 'YouTube', aspect: '16:9' },
    { value: 'square', label: 'Square', aspect: '1:1' },
    { value: 'landscape', label: 'Landscape', aspect: '16:9' },
  ]

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
    }
  }

  const handleSubmit = async () => {
    if (!prompt) return

    setIsProcessing(true)
    try {
      const formData = new FormData()
      formData.append('prompt', prompt)
      formData.append('format', format)
      if (file) {
        formData.append('video', file)
      }

      const response = await fetch('/api/edit', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json() as { outputUrl?: string }
      if (data.outputUrl) {
        setOutputUrl(data.outputUrl)
      }
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="h-6 w-6" />
            AI Video Editor
          </CardTitle>
          <CardDescription>
            動画をアップロードして、AIに編集を指示してください
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* File Upload */}
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <input
              type="file"
              accept="video/*"
              onChange={handleFileChange}
              className="hidden"
              id="video-upload"
            />
            <label htmlFor="video-upload" className="cursor-pointer">
              <Upload className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <p className="text-lg font-medium">
                {file ? file.name : '動画をアップロード'}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                クリックまたはドラッグ＆ドロップ
              </p>
            </label>
          </div>

          {/* Format Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">出力フォーマット</label>
            <div className="flex gap-2 flex-wrap">
              {formats.map((f) => (
                <Button
                  key={f.value}
                  variant={format === f.value ? 'default' : 'outline'}
                  onClick={() => setFormat(f.value)}
                  className="flex-1 min-w-[100px]"
                >
                  {f.label}
                  <span className="text-xs ml-1 opacity-70">({f.aspect})</span>
                </Button>
              ))}
            </div>
          </div>

          {/* Prompt Input */}
          <div>
            <label className="block text-sm font-medium mb-2">編集指示</label>
            <Textarea
              placeholder="例: 最初の10秒をカットして、テキスト「こんにちは」を追加して、BGMを入れて"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
            />
          </div>

          {/* Submit Button */}
          <Button
            onClick={handleSubmit}
            disabled={!prompt || isProcessing}
            className="w-full"
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

          {/* Output */}
          {outputUrl && (
            <div className="mt-6 p-4 bg-green-50 rounded-lg">
              <p className="text-green-800 font-medium mb-2">編集完了！</p>
              <Button asChild>
                <a href={outputUrl} download>
                  <Download className="h-4 w-4 mr-2" />
                  ダウンロード
                </a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
