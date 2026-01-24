import { z } from 'zod'

export const VideoFormatSchema = z.enum(['tiktok', 'youtube', 'square', 'landscape'])

export const VideoEditRequestSchema = z.object({
  prompt: z.string().min(1, 'プロンプトを入力してください'),
  format: VideoFormatSchema.default('tiktok'),
  videoFile: z.instanceof(File).optional(),
  videoUrl: z.string().url().optional(),
})

export const VideoEditResponseSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  outputUrl: z.string().url().optional(),
  error: z.string().optional(),
  createdAt: z.string(),
})

export const JobStatusSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  progress: z.number().min(0).max(100),
  outputUrl: z.string().url().optional(),
  error: z.string().optional(),
})

export type VideoFormat = z.infer<typeof VideoFormatSchema>
export type VideoEditRequest = z.infer<typeof VideoEditRequestSchema>
export type VideoEditResponse = z.infer<typeof VideoEditResponseSchema>
export type JobStatus = z.infer<typeof JobStatusSchema>
