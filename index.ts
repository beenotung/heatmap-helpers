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
  /** @description default `5` */
  min_grid_height?: number
  /** @description default `5` */
  min_grid_width?: number
  /**
   * @returns `0..1`
   * */
  calc_score: (context: HeatmapContext) => number | Promise<number>
  should_zoom: (score: number) => boolean
}) {
  let { calc_score, should_zoom } = args

  let slide_ratio = args.slide_ratio || 0.5

  let min_grid_width = args.min_grid_width || 5
  let min_grid_height = args.min_grid_height || 5

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

  async function loop_region(
    left: number,
    top: number,
    width: number,
    height: number,
    w: number,
    h: number,
  ) {
    let occlusion_weights = get_occlusion_weights(w, h)
    heatmap_buffer_canvas.width = w
    heatmap_buffer_canvas.height = h
    let heatmap_buffer_image_data = heatmap_buffer_context.getImageData(
      0,
      0,
      w,
      h,
    )

    function add_heatmap_sample(sample: {
      x: number
      y: number
      w: number
      h: number
      score: number
    }) {
      let { x, y, w, h, score } = sample
      let weights = get_occlusion_weights(w, h)
      if (score) {
        // score = 0.5
      }
      let offset = 0
      let offset_by_line = -w * 4 + heatmap_buffer_image_data.width * 4
      let i = 0
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          let weight = weights[i]
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

    async function tick(x: number, y: number) {
      let backup = occlude_rect(image_data, occlusion_weights, x, y, w, h)
      image_context.putImageData(image_data, 0, 0)
      let score = await calc_score(context)
      add_heatmap_sample({ x, y, w, h, score })
      let new_width = w
      let new_height = h
      let new_w = ceil(new_width / 2)
      let new_h = ceil(new_height / 2)
      if (
        new_w >= min_grid_width &&
        new_h >= min_grid_height &&
        new_w != w &&
        new_h != h &&
        should_zoom(score)
      ) {
        add_region([x, y, new_width, new_height, new_w, new_h])
      }
      await sleep(slide_interval)
      restore_rect(image_data, backup, x, y, w, h)
      image_context.putImageData(image_data, 0, 0)
    }

    async function loop_x(y: number) {
      for (let x = left; x - left + w <= width; ) {
        await tick(x, y)
        x += x_slide
        if (x - left == width) {
          break
        }
        if (x - left + w > width) {
          x = left + width - w
          await tick(x, y)
          break
        }
      }
    }
    let y_slide = calc_slide(height, h * slide_ratio)
    let x_slide = calc_slide(width, w * slide_ratio)
    for (let y = top; y - top + h <= height; ) {
      await loop_x(y)
      y += y_slide
      if (y - top == height) {
        break
      }
      if (y - top + h > height) {
        y = top + height - h
        await loop_x(y)
        break
      }
    }
  }

  let w = ceil(args.max_grid_height || image_canvas.width / 2)
  let h = ceil(args.max_grid_width || image_canvas.height / 2)

  type Region = [
    x: number,
    y: number,
    width: number,
    height: number,
    w: number,
    h: number,
  ]
  let regions: Region[] = [
    [0, 0, image_canvas.width, image_canvas.height, w, h],
  ]

  function add_region(region: Region) {
    regions.push(region)
  }

  for (;;) {
    let [region] = regions.splice(0, 1)
    if (!region) break
    let [x, y, width, height, w, h] = region
    await loop_region(x, y, width, height, w, h)
    image_data = image_context.getImageData(
      0,
      0,
      image_canvas.width,
      image_canvas.height,
    )
    await sleep(1)
  }
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
