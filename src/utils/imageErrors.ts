export type OversizedImage = {
  index: number
  size: number
}

function formatFileSize(sizeInBytes: number): string {
  const kb = sizeInBytes / 1024
  if (kb < 1) return `${sizeInBytes} bytes`
  if (kb < 1024) return `${kb.toFixed(1).replace(/\.0$/, '')}KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1).replace(/\.0$/, '')}MB`
  const gb = mb / 1024
  return `${gb.toFixed(1).replace(/\.0$/, '')}GB`
}

export class ImageSizeError extends Error {
  constructor(oversizedImages: OversizedImage[], maxSize: number) {
    const firstImage = oversizedImages[0]
    const message =
      oversizedImages.length === 1 && firstImage
        ? `Image base64 size (${formatFileSize(firstImage.size)}) exceeds API limit (${formatFileSize(maxSize)}). Please resize the image before sending.`
        : `${oversizedImages.length} images exceed the API limit (${formatFileSize(maxSize)}): ${oversizedImages
            .map(image => `Image ${image.index}: ${formatFileSize(image.size)}`)
            .join(', ')}. Please resize these images before sending.`
    super(message)
    this.name = 'ImageSizeError'
  }
}

export class ImageResizeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageResizeError'
  }
}
