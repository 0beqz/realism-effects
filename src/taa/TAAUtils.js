import { generateR2 } from "../temporal-reproject/utils/QuasirandomGenerator"

export const r2Sequence = generateR2(256).map(([a, b]) => [a - 0.5, b - 0.5])

export function jitter(width, height, camera, frame, jitterScale = 1) {
	const [x, y] = r2Sequence[frame % r2Sequence.length]

	if (camera.setViewOffset) {
		camera.setViewOffset(width, height, x * jitterScale, y * jitterScale, width, height)
	}
}
