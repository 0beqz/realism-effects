/* eslint-disable camelcase */
import { calculate_bins } from "../wasm/envmap_importance_sample_wasm"

console.log("wow")

onmessage = ev => {
	const { data, width, height } = ev

	const luminanceSq = (r, g, b) => (r * 0.2125 + g * 0.7154 + b * 0.0721) ** 2

	let dataArr = []
	let index = 0
	let avgLum = 0
	for (let i = 0; i < data.length; i += 4) {
		dataArr[index++] = data[i] / 0x4000
		dataArr[index++] = data[i + 1] / 0x4000
		dataArr[index++] = data[i + 2] / 0x4000

		avgLum += luminanceSq(...data.slice(i, i + 3))
	}

	avgLum /= width * height

	const pow = Math.max(0, (Math.log(avgLum) - 16) / 2.5)

	dataArr = new Float32Array(dataArr)
	const bins = calculate_bins(dataArr, width, height, 10000 * 10 ** pow, 1 * 1)

	console.log(bins)

	postMessage(bins)
}
