import { VideoEditor } from '@/components/video/VideoEditor'

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 py-12">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">
          AI Video Editor
        </h1>
        <p className="text-gray-600">
          Powered by Qwen3-VL
        </p>
      </div>
      <VideoEditor />
    </main>
  )
}
