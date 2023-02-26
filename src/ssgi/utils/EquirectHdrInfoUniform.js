// source: https://github.com/gkjohnson/three-gpu-pathtracer/blob/main/src/uniforms/EquirectHdrInfoUniform.js

/* eslint-disable camelcase */
import { DataTexture, FloatType, LinearFilter, RedFormat, RepeatWrapping, RGBAFormat } from "three"

function colorToLuminance(r, g, b) {
	// https://en.wikipedia.org/wiki/Relative_luminance
	return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function binarySearchFindClosestIndexOf(array, targetValue, offset = 0, count = array.length) {
	let lower = 0
	let upper = count - 1
	while (lower < upper) {
		const mid = ~~(0.5 * upper + 0.5 * lower)

		// check if the middle array value is above or below the target and shift
		// which half of the array we're looking at
		if (array[offset + mid] < targetValue) {
			lower = mid + 1
		} else {
			upper = mid
		}
	}

	return lower
}

const gatherData = (data, width, height, flipY, marginalDataArray, conditionalDataArray) => {
	// "conditional" = "pixel relative to row pixels sum"
	// "marginal" = "row relative to row sum"

	let newData = data

	// remove any y flipping for cdf computation
	if (flipY) {
		const ogData = newData
		newData = newData.slice()
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const newY = height - y - 1
				const ogIndex = 4 * (y * width + x)
				const newIndex = 4 * (newY * width + x)

				newData[newIndex + 0] = ogData[ogIndex + 0]
				newData[newIndex + 1] = ogData[ogIndex + 1]
				newData[newIndex + 2] = ogData[ogIndex + 2]
				newData[newIndex + 3] = ogData[ogIndex + 3]
			}
		}

		data = newData
	}

	// track the importance of any given pixel in the image by tracking its weight relative to other pixels in the image
	const pdfConditional = new Float32Array(width * height)
	const cdfConditional = new Float32Array(width * height)

	const pdfMarginal = new Float32Array(height)
	const cdfMarginal = new Float32Array(height)

	let totalSumValue = 0.0
	let cumulativeWeightMarginal = 0.0
	for (let y = 0; y < height; y++) {
		let cumulativeRowWeight = 0.0
		for (let x = 0; x < width; x++) {
			const i = y * width + x
			const r = data[4 * i + 0]
			const g = data[4 * i + 1]
			const b = data[4 * i + 2]

			// the probability of the pixel being selected in this row is the
			// scale of the luminance relative to the rest of the pixels.
			// TODO: this should also account for the solid angle of the pixel when sampling
			const weight = colorToLuminance(r, g, b)
			cumulativeRowWeight += weight
			totalSumValue += weight

			pdfConditional[i] = weight
			cdfConditional[i] = cumulativeRowWeight
		}

		// can happen if the row is all black
		if (cumulativeRowWeight !== 0) {
			// scale the pdf and cdf to [0.0, 1.0]
			for (let i = y * width, l = y * width + width; i < l; i++) {
				pdfConditional[i] /= cumulativeRowWeight
				cdfConditional[i] /= cumulativeRowWeight
			}
		}

		cumulativeWeightMarginal += cumulativeRowWeight

		// compute the marginal pdf and cdf along the height of the map.
		pdfMarginal[y] = cumulativeRowWeight
		cdfMarginal[y] = cumulativeWeightMarginal
	}

	// can happen if the texture is all black
	if (cumulativeWeightMarginal !== 0) {
		// scale the marginal pdf and cdf to [0.0, 1.0]
		for (let i = 0, l = pdfMarginal.length; i < l; i++) {
			pdfMarginal[i] /= cumulativeWeightMarginal
			cdfMarginal[i] /= cumulativeWeightMarginal
		}
	}

	// compute a sorted index of distributions and the probabilities along them for both
	// the marginal and conditional data. These will be used to sample with a random number
	// to retrieve a uv value to sample in the environment map.
	// These values continually increase so it's okay to interpolate between them.

	// we add a half texel offset so we're sampling the center of the pixel
	for (let i = 0; i < height; i++) {
		const dist = (i + 1) / height
		const row = binarySearchFindClosestIndexOf(cdfMarginal, dist)

		marginalDataArray[i] = (row + 0.5) / height
	}

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = y * width + x
			const dist = (x + 1) / width
			const col = binarySearchFindClosestIndexOf(cdfConditional, dist, y * width, width)

			conditionalDataArray[i] = (col + 0.5) / width
		}
	}

	return totalSumValue
}

const workerOnMessage = ({ data: { width, height, flipY, data } }) => {
	const marginalDataArray = new Float32Array(height)
	const conditionalDataArray = new Float32Array(width * height)

	const totalSumValue = gatherData(data, width, height, flipY, marginalDataArray, conditionalDataArray)

	postMessage({ totalSumValue, marginalDataArray, conditionalDataArray })
}

const code = `
	const colorToLuminance = ${colorToLuminance.toString()}
	const binarySearchFindClosestIndexOf = ${binarySearchFindClosestIndexOf.toString()}
	const gatherData = ${gatherData.toString()}

	onmessage = ${workerOnMessage}
`

export class EquirectHdrInfoUniform {
	constructor() {
		// Default to a white texture and associated weights so we don't
		// just render black initially.
		const whiteTex = new DataTexture(new Float32Array([1, 1, 1, 1]), 1, 1)
		whiteTex.type = FloatType
		whiteTex.format = RGBAFormat
		whiteTex.minFilter = LinearFilter
		whiteTex.magFilter = LinearFilter
		whiteTex.wrapS = RepeatWrapping
		whiteTex.wrapT = RepeatWrapping
		whiteTex.generateMipmaps = false
		whiteTex.needsUpdate = true

		// Stores a map of [0, 1] value -> cumulative importance row & pdf
		// used to sampling a random value to a relevant row to sample from
		const marginalWeights = new DataTexture(new Float32Array([0, 1]), 1, 2)
		marginalWeights.type = FloatType
		marginalWeights.format = RedFormat
		marginalWeights.minFilter = LinearFilter
		marginalWeights.magFilter = LinearFilter
		marginalWeights.generateMipmaps = false
		marginalWeights.needsUpdate = true

		// Stores a map of [0, 1] value -> cumulative importance column & pdf
		// used to sampling a random value to a relevant pixel to sample from
		const conditionalWeights = new DataTexture(new Float32Array([0, 0, 1, 1]), 2, 2)
		conditionalWeights.type = FloatType
		conditionalWeights.format = RedFormat
		conditionalWeights.minFilter = LinearFilter
		conditionalWeights.magFilter = LinearFilter
		conditionalWeights.generateMipmaps = false
		conditionalWeights.needsUpdate = true

		this.map = whiteTex
		this.marginalWeights = marginalWeights
		this.conditionalWeights = conditionalWeights

		// the total sum value is separated into two values to work around low precision
		// storage of floating values in structs
		this.totalSumWhole = 1
		this.totalSumDecimal = 0
	}

	dispose() {
		this.marginalWeights.dispose()
		this.conditionalWeights.dispose()
		this.map.dispose()
	}

	updateFrom(map) {
		return new Promise(resolve => {
			this.worker?.terminate()

			const { width, height, data } = map.image

			const blob = new Blob([code], { type: "application/javascript" })
			this.worker = new Worker(URL.createObjectURL(blob))

			this.worker.postMessage({ width, height, flipY: map.flipY, data })
			this.worker.onmessage = ({ data: { totalSumValue, marginalDataArray, conditionalDataArray } }) => {
				this.dispose()

				const { marginalWeights, conditionalWeights } = this
				marginalWeights.image = { width: height, height: 1, data: marginalDataArray }
				marginalWeights.needsUpdate = true

				conditionalWeights.image = { width, height, data: conditionalDataArray }
				conditionalWeights.needsUpdate = true

				const totalSumWhole = ~~totalSumValue
				const totalSumDecimal = totalSumValue - totalSumWhole
				this.totalSumWhole = totalSumWhole
				this.totalSumDecimal = totalSumDecimal

				this.map = map

				this.worker = null

				resolve()
			}
		})
	}
}
