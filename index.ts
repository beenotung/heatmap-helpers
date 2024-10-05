let { abs, random, round, floor, ceil, max, min, sqrt } = Math

type Rect = { width: number; height: number }

type Color = [r: number, g: number, b: number]

export function xy_to_offset(rect: Rect, x: number, y: number): number {
  return (y * rect.width + x) * 4
}

export function calc_mean_color(
  imageData: ImageData,
  x: number,
  y: number,
  w: number,
  h: number,
): Color {
  let r = 0
  let g = 0
  let b = 0
  let offset = xy_to_offset(imageData, x, y)
  for (let i = 0; i < h; i++) {
    for (let j = 0; j < w; j++) {
      r += imageData.data[offset + 0]
      g += imageData.data[offset + 1]
      b += imageData.data[offset + 2]
      offset += 4
    }
    offset = offset - w * 4 + imageData.width * 4
  }
  let n = w * h
  r = floor(r / n)
  g = floor(g / n)
  b = floor(b / n)
  return [r, g, b]
}

export function pick_occlusion_color(mean_color: Color): number {
  let black_dist = mean_color[0] ** 2 + mean_color[1] ** 2 + mean_color[2] ** 2
  let white_dist =
    (255 - mean_color[0]) ** 2 +
    (255 - mean_color[1]) ** 2 +
    (255 - mean_color[2]) ** 2
  let gray_dist =
    (127 - mean_color[0]) ** 2 +
    (127 - mean_color[1]) ** 2 +
    (127 - mean_color[2]) ** 2
  if (black_dist > white_dist && black_dist > gray_dist) {
    return 0
  }
  if (white_dist > black_dist && white_dist > gray_dist) {
    return 255
  }
  return 127
}

export function occlude_rect(
  imageData: ImageData,
  x: number,
  y: number,
  w: number,
  h: number,
): Uint8ClampedArray {
  let mean_color = calc_mean_color(imageData, x, y, w, h)
  let occlusion_color = pick_occlusion_color(mean_color)
  let offset = xy_to_offset(imageData, x, y)
  let backup = imageData.data.slice(
    offset,
    offset + imageData.width * imageData.height * 4,
  )
  let backup_offset = 0
  for (let dy = 0; dy < h; dy++) {
    let weight_y = abs(dy - h / 2) / (h / 2)
    for (let dx = 0; dx < w; dx++) {
      let weight_x = abs(dx - w / 2) / (w / 2)
      let weight = 1 - max(weight_x, weight_y) ** 2
      for (let i = 0; i < 3; i++) {
        let value = imageData.data[offset + i]
        backup[backup_offset + i] = value
        imageData.data[offset + i] = floor(
          weight * occlusion_color + (1 - weight) * value,
        )
      }
      offset += 4
      backup_offset += 4
    }
    offset = offset - w * 4 + imageData.width * 4
  }
  return backup
}

export function restore_rect(
  imageData: ImageData,
  backup: Uint8ClampedArray,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  let offset = xy_to_offset(imageData, x, y)
  let backup_offset = 0
  for (let i = 0; i < h; i++) {
    for (let j = 0; j < w; j++) {
      imageData.data[offset + 0] = backup[backup_offset + 0]
      imageData.data[offset + 1] = backup[backup_offset + 1]
      imageData.data[offset + 2] = backup[backup_offset + 2]
      offset += 4
      backup_offset += 4
    }
    offset = offset - w * 4 + imageData.width * 4
  }
}

let slide_interval = 0

export async function build_heatmap(args: {
  canvas: HTMLCanvasElement
  context?: CanvasRenderingContext2D
  imageData?: ImageData
  /** @description default 0.5 */
  slideRatio?: number
}) {
  let canvas = args.canvas
  let context = args.context || canvas.getContext('2d')!
  let imageData =
    args.imageData || context.getImageData(0, 0, canvas.width, canvas.height)
  let slideRatio = args.slideRatio ?? 0.5

  let w = ceil(canvas.width / 50)
  let h = ceil(canvas.height / 50)

  // let x = 250
  // let y = 125
  // context.lineWidth = 1
  // context.strokeStyle = 'red'
  // context.fillStyle = 'yellow'
  // context.rect(x, y, w, h)
  // context.stroke()

  let x_slide = floor(w * slideRatio)
  let y_slide = floor(h * slideRatio)

  let last_x = false
  let last_y = false
  slide: for (let y = 0; y < canvas.height; ) {
    for (let x = 0; x < canvas.width; ) {
      let backup = occlude_rect(imageData, x, y, w, h)
      context.putImageData(imageData, 0, 0)
      await sleep(slide_interval)
      // restore_rect(imageData, backup, x, y, w, h)
      context.putImageData(imageData, 0, 0)

      if (x + w == canvas.width) {
        x = 0
        if (y + h == canvas.height) {
          last_y = true
          if (last_x && last_y) {
            break slide
          }
        }
        y += y_slide
        if (y + h > canvas.height) {
          y = canvas.height - h
        }
        continue
      }
      x += x_slide
      if (x + w > canvas.width) {
        x = canvas.width - w
        last_x = true
      }
    }
  }
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
