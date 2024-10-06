import { generate_heatmap_values, heatmap_schemes } from 'heatmap-values'

let heatmap_values = generate_heatmap_values(
  heatmap_schemes.red_transparent_blue,
)

let { abs, round, floor, ceil, max } = Math

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

// w -> h -> (weights)
let occlusion_weights: number[][][] = []

function get_occlusion_weights(w: number, h: number): number[] {
  if (!(w in occlusion_weights)) {
    occlusion_weights[w] = []
  }
  let h_weights = occlusion_weights[w]
  if (h in h_weights) {
    return h_weights[h]
  }
  let weights: number[] = new Array(w * h)
  let h_2 = h / 2
  let w_2 = w / 2
  let i = 0
  for (let dy = 0; dy < h; dy++) {
    let weight_y = ((dy - h_2) / h_2) ** 2
    for (let dx = 0; dx < w; dx++) {
      let weight_x = ((dx - w_2) / w_2) ** 2
      let weight = (1 - max(weight_x, weight_y)) * 2
      weights[i] = weight
      i++
    }
  }
  h_weights[h] = weights
  return weights
}

export function occlude_rect(
  imageData: ImageData,
  occlusion_weights: number[],
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
  let weight_offset = 0
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      let weight = occlusion_weights[weight_offset]
      for (let i = 0; i < 3; i++) {
        let value = imageData.data[offset + i]
        backup[backup_offset + i] = value
        imageData.data[offset + i] = floor(
          weight * occlusion_color + (1 - weight) * value,
        )
      }
      offset += 4
      backup_offset += 4
      weight_offset++
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

function calc_slide(total_size: number, slide: number) {
  slide = ceil(slide)
  let count = ceil((total_size - slide) / slide)
  slide = ceil((total_size - slide) / count)
  return slide
}

let slide_interval = 0

export type HeatmapContext = {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  image_data: ImageData
}

export async function build_heatmap(args: {
  canvas: HTMLCanvasElement
  context?: CanvasRenderingContext2D
  image_data?: ImageData
  /** @description default `0.5` */
  slide_ratio?: number
  /** @description default `ceil(canvas.height * 0.5)` */
  max_grid_height?: number
  /** @description default `ceil(canvas.width * 0.5)` */
  max_grid_width?: number
  /** @returns 0..1 */
  calc_score: (context: HeatmapContext) => number | Promise<number>
}) {
  let canvas = args.canvas
  let context = args.context || canvas.getContext('2d')!
  let image_data =
    args.image_data || context.getImageData(0, 0, canvas.width, canvas.height)
  let slideRatio = args.slide_ratio ?? 0.5

  let heatmap_scores: {
    x: number
    y: number
    w: number
    h: number
    score: number
  }[] = []

  let heatmap_context: HeatmapContext = {
    canvas,
    context,
    image_data,
  }

  async function tick(x: number, y: number, w: number, h: number) {
    let backup = occlude_rect(image_data, occlusion_weights, x, y, w, h)
    context.putImageData(image_data, 0, 0)
    let score = await args.calc_score(heatmap_context)
    heatmap_scores.push({ x, y, w, h, score })
    await sleep(slide_interval)
    restore_rect(image_data, backup, x, y, w, h)
    context.putImageData(image_data, 0, 0)
  }

  function draw_heatmap() {
    console.log('draw heatmap:', heatmap_scores)
    for (let { x, y, w, h, score } of heatmap_scores) {
      let value = round(score * 255)
      let color = heatmap_values[value]
      context.fillStyle = `rgba(${color})`
      context.fillRect(x, y, w, h)
      console.log('fill', { x, y, w, h, color: context.fillStyle })
    }
  }

  // TODO fine-grain explore area of interest, instead of full range scanning
  async function loop_slide(w: number, h: number) {
    async function loop_x(y: number) {
      for (let x = 0; x + w <= canvas.width; ) {
        await tick(x, y, w, h)
        x += x_slide
        if (x + w > canvas.width) {
          x = canvas.width - w
          await tick(x, y, w, h)
          break
        }
      }
    }
    let y_slide = calc_slide(canvas.height, h * slideRatio)
    let x_slide = calc_slide(canvas.width, w * slideRatio)
    for (let y = 0; y + h <= canvas.height; ) {
      await loop_x(y)
      y += y_slide
      if (y + h > canvas.height) {
        y = canvas.height - h
        await loop_x(y)
        break
      }
    }
  }

  let w = ceil(args.max_grid_height || canvas.width / 2)
  let h = ceil(args.max_grid_width || canvas.height / 2)
  let occlusion_weights = get_occlusion_weights(w, h)
  // await loop_slide(w, h)
  // draw_heatmap()
  for (let i = 0; i < 100; i++) {
    await loop_slide(w, h)
    draw_heatmap()
    image_data = context.getImageData(0, 0, canvas.width, canvas.height)
    heatmap_scores.length = 0
    await sleep(1)
    w = ceil(w * 0.9)
    h = ceil(h * 0.9)
    occlusion_weights = get_occlusion_weights(w, h)
  }
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
