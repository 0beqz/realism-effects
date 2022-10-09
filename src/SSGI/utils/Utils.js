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

export const keepMaterialMapUpdated = (mrtMaterial, originalMaterial, prop, define, useKey) => {
	if (useKey) {
		if (originalMaterial[prop] !== mrtMaterial[prop]) {
			mrtMaterial[prop] = originalMaterial[prop]
			mrtMaterial.uniforms[prop].value = originalMaterial[prop]

			if (originalMaterial[prop]) {
				mrtMaterial.defines[define] = ""
			} else {
				delete mrtMaterial.defines[define]
			}

			mrtMaterial.needsUpdate = true
		}
	} else if (mrtMaterial[prop] !== undefined) {
		mrtMaterial[prop] = undefined
		mrtMaterial.uniforms[prop].value = undefined
		delete mrtMaterial.defines[define]
		mrtMaterial.needsUpdate = true
	}
}
