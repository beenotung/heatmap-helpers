# heatmap-helpers

Helper functions to build heatmap visualization with canvas. Support dynamic grid size and zoom level based on custom scoring function.

[![npm Package Version](https://img.shields.io/npm/v/heatmap-helpers)](https://www.npmjs.com/package/heatmap-helpers)
[![Minified Package Size](https://img.shields.io/bundlephobia/min/heatmap-helpers)](https://bundlephobia.com/package/heatmap-helpers)
[![Minified and Gzipped Package Size](https://img.shields.io/bundlephobia/minzip/heatmap-helpers)](https://bundlephobia.com/package/heatmap-helpers)

## Features

- Support custom scoring function
- Support dynamic grid size and zoom level
- Typescript support
- Isomorphic package: works in Node.js and browsers

## Installation

```bash
npm install heatmap-helpers
```

You can also install `heatmap-helpers` with [pnpm](https://pnpm.io/), [yarn](https://yarnpkg.com/), or [slnpm](https://github.com/beenotung/slnpm)

## Usage Example

```typescript
import { build_heatmap } from 'heatmap-helpers'

build_heatmap({
  image_canvas,
  heatmap_canvas,
  slide_ratio: 0.5,
  min_grid_height: 20,
  min_grid_width: 20,
  calc_score() {
    let delta_change = Math.random() * 2 - 1
    let score = (delta_change + 1) / 2
    return score
  },
  should_zoom(score) {
    let gap = 0.8
    if (gap > 0.5) {
      gap = 1 - gap
    }
    return score <= gap || score >= 1 - gap
  },
})
```

## Typescript Signature

```typescript
export function build_heatmap(args: {
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
}): Promise<void>

export type HeatmapContext = {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  image_data: ImageData
}

export function xy_to_offset(rect: Rect, x: number, y: number): number

export type Rect = {
  width: number
  height: number
}
```

## License

This project is licensed with [BSD-2-Clause](./LICENSE)

This is free, libre, and open-source software. It comes down to four essential freedoms [[ref]](https://seirdy.one/2021/01/27/whatsapp-and-the-domestication-of-users.html#fnref:2):

- The freedom to run the program as you wish, for any purpose
- The freedom to study how the program works, and change it so it does your computing as you wish
- The freedom to redistribute copies so you can help others
- The freedom to distribute copies of your modified versions to others
