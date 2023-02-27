// source: https://github.com/gkjohnson/three-gpu-pathtracer/blob/main/src/uniforms/EquirectHdrInfoUniform.js

import { DataTexture, FloatType, LinearFilter, RedFormat, RepeatWrapping, RGBAFormat } from "three"

const workerOnMessage = ({ data: { width, height, isFloatType, flipY, data } }) => {
	// from: https://github.com/mrdoob/three.js/blob/dev/src/extras/DataUtils.js

	// importing modules doesn't seem to work for workers that were generated through createObjectURL() for some reason

	const _tables = /* @__PURE__*/ _generateTables()

	function _generateTables() {
		// float32 to float16 helpers

		const buffer = new ArrayBuffer(4)
		const floatView = new Float32Array(buffer)
		const uint32View = new Uint32Array(buffer)

		const baseTable = new Uint32Array(512)
		const shiftTable = new Uint32Array(512)

		for (let i = 0; i < 256; ++i) {
			const e = i - 127

			// very small number (0, -0)

			if (e < -27) {
				baseTable[i] = 0x0000
				baseTable[i | 0x100] = 0x8000
				shiftTable[i] = 24
				shiftTable[i | 0x100] = 24

				// small number (denorm)
			} else if (e < -14) {
				baseTable[i] = 0x0400 >> (-e - 14)
				baseTable[i | 0x100] = (0x0400 >> (-e - 14)) | 0x8000
				shiftTable[i] = -e - 1
				shiftTable[i | 0x100] = -e - 1

				// normal number
			} else if (e <= 15) {
				baseTable[i] = (e + 15) << 10
				baseTable[i | 0x100] = ((e + 15) << 10) | 0x8000
				shiftTable[i] = 13
				shiftTable[i | 0x100] = 13

				// large number (Infinity, -Infinity)
			} else if (e < 128) {
				baseTable[i] = 0x7c00
				baseTable[i | 0x100] = 0xfc00
				shiftTable[i] = 24
				shiftTable[i | 0x100] = 24

				// stay (NaN, Infinity, -Infinity)
			} else {
				baseTable[i] = 0x7c00
				baseTable[i | 0x100] = 0xfc00
				shiftTable[i] = 13
				shiftTable[i | 0x100] = 13
			}
		}

		// float16 to float32 helpers

		const mantissaTable = new Uint32Array(2048)
		const exponentTable = new Uint32Array(64)
		const offsetTable = new Uint32Array(64)

		for (let i = 1; i < 1024; ++i) {
			let m = i << 13 // zero pad mantissa bits
			let e = 0 // zero exponent

			// normalized
			while ((m & 0x00800000) === 0) {
				m <<= 1
				e -= 0x00800000 // decrement exponent
			}

			m &= ~0x00800000 // clear leading 1 bit
			e += 0x38800000 // adjust bias

			mantissaTable[i] = m | e
		}

		for (let i = 1024; i < 2048; ++i) {
			mantissaTable[i] = 0x38000000 + ((i - 1024) << 13)
		}

		for (let i = 1; i < 31; ++i) {
			exponentTable[i] = i << 23
		}

		exponentTable[31] = 0x47800000
		exponentTable[32] = 0x80000000

		for (let i = 33; i < 63; ++i) {
			exponentTable[i] = 0x80000000 + ((i - 32) << 23)
		}

		exponentTable[63] = 0xc7800000

		for (let i = 1; i < 64; ++i) {
			if (i !== 32) {
				offsetTable[i] = 1024
			}
		}

		return {
			floatView: floatView,
			uint32View: uint32View,
			baseTable: baseTable,
			shiftTable: shiftTable,
			mantissaTable: mantissaTable,
			exponentTable: exponentTable,
			offsetTable: offsetTable
		}
	}

	function fromHalfFloat(val) {
		const m = val >> 10
		_tables.uint32View[0] = _tables.mantissaTable[_tables.offsetTable[m] + (val & 0x3ff)] + _tables.exponentTable[m]
		return _tables.floatView[0]
	}

	function colorToLuminance(r, g, b) {
		// https://en.wikipedia.org/wiki/Relative_luminance
		return 0.2126 * r + 0.7152 * g + 0.0722 * b
	}

	const binarySearchFindClosestIndexOf = (array, targetValue, offset = 0, count = array.length) => {
		let lower = offset
		let upper = offset + count - 1

		while (lower < upper) {
			const mid = (lower + upper) >> 1

			// check if the middle array value is above or below the target and shift
			// which half of the array we're looking at
			if (array[mid] < targetValue) {
				lower = mid + 1
			} else {
				upper = mid
			}
		}

		return lower - offset
	}

	const gatherData = (data, width, height, flipY, marginalDataArray, conditionalDataArray) => {
		// "conditional" = "pixel relative to row pixels sum"
		// "marginal" = "row relative to row sum"

		// remove any y flipping for cdf computation
		if (flipY) {
			for (let y = 0, h = height - 1; y <= h; y++) {
				for (let x = 0, w = width * 4; x < w; x += 4) {
					const newY = h - y
					const ogIndex = y * w + x
					const newIndex = newY * w + x
					data[newIndex] = data[ogIndex]
					data[newIndex + 1] = data[ogIndex + 1]
					data[newIndex + 2] = data[ogIndex + 2]
					data[newIndex + 3] = data[ogIndex + 3]
				}
			}
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

	if (!isFloatType) {
		const newData = new Float32Array(data.length)
		// eslint-disable-next-line guard-for-in
		for (const i in data) {
			newData[i] = fromHalfFloat(data[i])
		}

		data = newData
	}

	const marginalDataArray = new Float32Array(height)
	const conditionalDataArray = new Float32Array(width * height)

	const totalSumValue = gatherData(data, width, height, flipY, marginalDataArray, conditionalDataArray)

	if (isFloatType) {
		postMessage({ totalSumValue, marginalDataArray, conditionalDataArray })
	} else {
		postMessage({ data, totalSumValue, marginalDataArray, conditionalDataArray })
	}
}

const blob = new Blob(["onmessage = " + workerOnMessage], { type: "application/javascript" })
const workerUrl = URL.createObjectURL(blob)

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
			const { type } = map

			this.worker = new Worker(workerUrl)

			this.worker.postMessage({ width, height, isFloatType: type === FloatType, flipY: map.flipY, data })
			this.worker.onmessage = ({ data: { data, totalSumValue, marginalDataArray, conditionalDataArray } }) => {
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

				if (data) {
					map.image.data = data
					map.type = FloatType
				}

				this.map = map
				this.worker = null

				resolve()
			}
		})
	}
}
