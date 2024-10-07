import { generate_heatmap_values, heatmap_schemes } from 'heatmap-values'

let heatmap_values = generate_heatmap_values(
  heatmap_schemes.red_transparent_blue,
)
for (let i = 0; i < 256; i++) {
  heatmap_values[i][3] *= 255
}

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
      let weight = 1 - max(weight_x, weight_y)
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
  let offset_by_line = -w * 4 + imageData.width * 4
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
    offset += offset_by_line
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
  let offset_by_line = -w * 4 + imageData.width * 4
  let backup_offset = 0
  for (let i = 0; i < h; i++) {
    for (let j = 0; j < w; j++) {
      imageData.data[offset + 0] = backup[backup_offset + 0]
      imageData.data[offset + 1] = backup[backup_offset + 1]
      imageData.data[offset + 2] = backup[backup_offset + 2]
      offset += 4
      backup_offset += 4
    }
    offset += offset_by_line
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
  image_canvas: HTMLCanvasElement
  heatmap_canvas: HTMLCanvasElement
  /** @description default `0.5` */
  slide_ratio?: number
  /** @description default `ceil(canvas.height * 0.5)` */
  max_grid_height?: number
  /** @description default `ceil(canvas.width * 0.5)` */
  max_grid_width?: number
  /** @returns 0..1 */
  calc_score: (context: HeatmapContext) => number | Promise<number>
}) {
  let slideRatio = args.slide_ratio ?? 0.5

  let image_canvas = args.image_canvas
  let image_context = image_canvas.getContext('2d')!
  let image_data = image_context.getImageData(
    0,
    0,
    image_canvas.width,
    image_canvas.height,
  )

  let heatmap_canvas = args.heatmap_canvas
  let heatmap_context = heatmap_canvas.getContext('2d')!
  let heatmap_data = heatmap_context.getImageData(
    0,
    0,
    heatmap_canvas.width,
    heatmap_canvas.height,
  )
  heatmap_data.data.fill(255)

  let heatmap_buffer_canvas = document.createElement('canvas')
  let heatmap_buffer_context = heatmap_buffer_canvas.getContext('2d')!

  let context: HeatmapContext = {
    canvas: image_canvas,
    context: image_context,
    image_data,
  }

  let heatmap_scores: {
    x: number
    y: number
    w: number
    h: number
    score: number
  }[] = []

  console.log(heatmap_values)

  function add_heatmap_sample(sample: (typeof heatmap_scores)[number]) {
    heatmap_scores.push(sample)
    let { x, y, w, h, score } = sample
    let offset = 0
    let offset_by_line = -w * 4 + heatmap_buffer_image_data.width * 4
    let i = 0
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        let weight = occlusion_weights[i]
        let value = round(score * 255)
        let color = heatmap_values[value]
        heatmap_buffer_image_data.data[offset + 0] = color[0]
        heatmap_buffer_image_data.data[offset + 1] = color[1]
        heatmap_buffer_image_data.data[offset + 2] = color[2]
        heatmap_buffer_image_data.data[offset + 3] = color[3] * weight
        i++
        offset += 4
      }
      offset += offset_by_line
    }
    heatmap_buffer_context.putImageData(heatmap_buffer_image_data, 0, 0)
    heatmap_context.drawImage(heatmap_buffer_canvas, x, y, w, h)
  }

  async function tick(x: number, y: number, w: number, h: number) {
    let backup = occlude_rect(image_data, occlusion_weights, x, y, w, h)
    image_context.putImageData(image_data, 0, 0)
    let score = await args.calc_score(context)
    add_heatmap_sample({ x, y, w, h, score })
    await sleep(slide_interval)
    restore_rect(image_data, backup, x, y, w, h)
    image_context.putImageData(image_data, 0, 0)
  }

  // TODO fine-grain explore area of interest, instead of full range scanning
  async function loop_slide(w: number, h: number) {
    async function loop_x(y: number) {
      for (let x = 0; x + w <= image_canvas.width; ) {
        await tick(x, y, w, h)
        x += x_slide
        if (x + w > image_canvas.width) {
          x = image_canvas.width - w
          await tick(x, y, w, h)
          break
        }
      }
    }
    let y_slide = calc_slide(image_canvas.height, h * slideRatio)
    let x_slide = calc_slide(image_canvas.width, w * slideRatio)
    for (let y = 0; y + h <= image_canvas.height; ) {
      await loop_x(y)
      y += y_slide
      if (y + h > image_canvas.height) {
        y = image_canvas.height - h
        await loop_x(y)
        break
      }
    }
  }

  let w = ceil(args.max_grid_height || image_canvas.width / 2)
  let h = ceil(args.max_grid_width || image_canvas.height / 2)
  let occlusion_weights = get_occlusion_weights(w, h)
  heatmap_buffer_canvas.width = w
  heatmap_buffer_canvas.height = h
  let heatmap_buffer_image_data = heatmap_buffer_context.getImageData(
    0,
    0,
    w,
    h,
  )
  // await loop_slide(w, h)
  // draw_heatmap()
  for (let i = 0; i < 100; i++) {
    await loop_slide(w, h)
    image_data = image_context.getImageData(
      0,
      0,
      image_canvas.width,
      image_canvas.height,
    )
    heatmap_scores.length = 0
    await sleep(1)
    w = ceil(w * 0.9)
    h = ceil(h * 0.9)
    occlusion_weights = get_occlusion_weights(w, h)
    heatmap_buffer_image_data = heatmap_buffer_context.getImageData(0, 0, w, h)
  }
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
