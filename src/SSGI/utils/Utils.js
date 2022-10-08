export const getVisibleChildren = object => {
	const queue = [object]
	const objects = []

	while (queue.length !== 0) {
		const mesh = queue.shift()
		if (mesh.material) objects.push(mesh)

		for (const c of mesh.children) {
			if (c.visible) queue.push(c)
		}
	}

	return objects
}

export const generateCubeUVSize = parameters => {
	const imageHeight = parameters.envMapCubeUVHeight

	if (imageHeight === null) return null

	const maxMip = Math.log2(imageHeight) - 2

	const texelHeight = 1.0 / imageHeight

	const texelWidth = 1.0 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16))

	return { texelWidth, texelHeight, maxMip }
}

export const setupEnvMap = (ssgiMaterial, envMap, envMapCubeUVHeight) => {
	ssgiMaterial.uniforms.envMap.value = envMap

	const envMapCubeUVSize = generateCubeUVSize({ envMapCubeUVHeight })

	ssgiMaterial.defines.ENVMAP_TYPE_CUBE_UV = ""
	ssgiMaterial.defines.CUBEUV_TEXEL_WIDTH = envMapCubeUVSize.texelWidth
	ssgiMaterial.defines.CUBEUV_TEXEL_HEIGHT = envMapCubeUVSize.texelHeight
	ssgiMaterial.defines.CUBEUV_MAX_MIP = envMapCubeUVSize.maxMip + ".0"

	ssgiMaterial.needsUpdate = true
}

// from https://github.com/mrdoob/three.js/blob/dev/examples/jsm/capabilities/WebGL.js#L18
export const isWebGL2Available = () => {
	try {
		const canvas = document.createElement("canvas")
		return !!(window.WebGL2RenderingContext && canvas.getContext("webgl2"))
	} catch (e) {
		return false
	}
}

// Adapted from https://github.com/ghewgill/picomath/blob/master/javascript/erf.js
function erf(x) {
	// constants
	const a1 = 0.254829592
	const a2 = -0.284496736
	const a3 = 1.421413741
	const a4 = -1.453152027
	const a5 = 1.061405429
	const p = 0.3275911

	// A&S formula 7.1.26
	const t = 1.0 / (1.0 + p * Math.abs(x))
	const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)

	return Math.sign(x) * y
}

// source: https://observablehq.com/@jobleonard/gaussian-kernel-calculater
function def_int_gaussian(x, mu, sigma) {
	return 0.5 * erf((x - mu) / (Math.SQRT2 * sigma))
}

export function gaussian_kernel(kernel_size = 5, sigma = 1, mu = 0, step = 1) {
	const end = 0.5 * kernel_size
	const start = -end
	const coeff = []
	let sum = 0
	let x = start
	let last_int = def_int_gaussian(x, mu, sigma)
	const acc = 0
	while (x < end) {
		x += step
		const new_int = def_int_gaussian(x, mu, sigma)
		const c = new_int - last_int
		coeff.push(c)
		sum += c
		last_int = new_int
	}

	// normalize
	sum = 1 / sum
	for (let i = 0; i < coeff.length; i++) {
		coeff[i] *= sum
	}
	return coeff
}
