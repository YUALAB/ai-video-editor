/**
 * Input sanitization utilities
 */

// Remove potentially dangerous characters from strings
export function sanitizeString(input: string): string {
  return input
    .replace(/[<>]/g, '') // Remove angle brackets (XSS prevention)
    .replace(/javascript:/gi, '') // Remove javascript: URLs
    .replace(/data:/gi, '') // Remove data: URLs in text context
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim()
}

// Sanitize filename to prevent path traversal
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_') // Replace unsafe chars with underscore
    .replace(/\.{2,}/g, '.') // Prevent directory traversal
    .substring(0, 255) // Limit length
}

// Validate file type based on MIME type
export function isValidVideoMimeType(mimeType: string): boolean {
  const validTypes = [
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-matroska',
  ]
  return validTypes.includes(mimeType.toLowerCase())
}

// Validate file size (max 500MB)
const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500MB in bytes

export function isValidFileSize(size: number): boolean {
  return size > 0 && size <= MAX_FILE_SIZE
}

// Sanitize prompt to prevent injection attacks
export function sanitizePrompt(prompt: string): string {
  return sanitizeString(prompt)
    .substring(0, 2000) // Limit prompt length
}
