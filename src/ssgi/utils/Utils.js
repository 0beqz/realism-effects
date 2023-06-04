import { DataTexture, FloatType, RGBAFormat, ShaderChunk, ShaderLib, UniformsUtils, Vector4 } from "three"

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

export const keepMaterialMapUpdated = (mrtMaterial, originalMaterial, prop, define, useKey) => {
	if (useKey) {
		if (originalMaterial[prop] !== mrtMaterial[prop]) {
			mrtMaterial[prop] = originalMaterial[prop]
			mrtMaterial.uniforms[prop].value = originalMaterial[prop]

			if (originalMaterial[prop]) {
				mrtMaterial.defines[define] = ""

				if (define === "USE_NORMALMAP") {
					mrtMaterial.defines.TANGENTSPACE_NORMALMAP = ""
				}
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

export const getMaxMipLevel = texture => {
	const { width, height } = texture.image

	return Math.floor(Math.log2(Math.max(width, height))) + 1
}

export const saveBoneTexture = object => {
	let boneTexture = object.material.uniforms.prevBoneTexture.value

	if (boneTexture && boneTexture.image.width === object.skeleton.boneTexture.image.width) {
		boneTexture = object.material.uniforms.prevBoneTexture.value
		boneTexture.image.data.set(object.skeleton.boneTexture.image.data)
	} else {
		boneTexture?.dispose()

		const boneMatrices = object.skeleton.boneTexture.image.data.slice()
		const size = object.skeleton.boneTexture.image.width

		boneTexture = new DataTexture(boneMatrices, size, size, RGBAFormat, FloatType)
		object.material.uniforms.prevBoneTexture.value = boneTexture

		boneTexture.needsUpdate = true
	}
}

export const updateVelocityDepthNormalMaterialBeforeRender = (c, camera) => {
	if (c.skeleton?.boneTexture) {
		c.material.uniforms.boneTexture.value = c.skeleton.boneTexture

		if (!("USE_SKINNING" in c.material.defines)) {
			c.material.defines.USE_SKINNING = ""
			c.material.defines.BONE_TEXTURE = ""

			c.material.needsUpdate = true
		}
	}

	c.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, c.matrixWorld)

	c.material.uniforms.velocityMatrix.value.multiplyMatrices(camera.projectionMatrix, c.modelViewMatrix)
}

export const updateVelocityDepthNormalMaterialAfterRender = (c, camera) => {
	c.material.uniforms.prevVelocityMatrix.value.multiplyMatrices(camera.projectionMatrix, c.modelViewMatrix)

	if (c.skeleton?.boneTexture) saveBoneTexture(c)
}

export const createGlobalDisableIblRadianceUniform = () => {
	if (!ShaderChunk.envmap_physical_pars_fragment.includes("iblRadianceDisabled")) {
		ShaderChunk.envmap_physical_pars_fragment = ShaderChunk.envmap_physical_pars_fragment.replace(
			"vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {",
			/* glsl */ `
		uniform bool iblRadianceDisabled;
	
		vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		 if(iblRadianceDisabled) return vec3(0.);
		`
		)
	}

	if ("iblRadianceDisabled" in ShaderLib.physical.uniforms) return ShaderLib.physical.uniforms["iblRadianceDisabled"]

	const globalIblRadianceDisabledUniform = {
		value: false
	}

	ShaderLib.physical.uniforms.iblRadianceDisabled = globalIblRadianceDisabledUniform

	const { clone } = UniformsUtils
	UniformsUtils.clone = uniforms => {
		const result = clone(uniforms)

		if ("iblRadianceDisabled" in uniforms) {
			result.iblRadianceDisabled = globalIblRadianceDisabledUniform
		}

		return result
	}

	return globalIblRadianceDisabledUniform
}

export const createGlobalDisableIblIradianceUniform = () => {
	if (!ShaderChunk.envmap_physical_pars_fragment.includes("iblIrradianceDisabled")) {
		ShaderChunk.envmap_physical_pars_fragment = ShaderChunk.envmap_physical_pars_fragment.replace(
			"vec3 getIBLIrradiance( const in vec3 normal ) {",
			/* glsl */ `
			uniform bool iblIrradianceDisabled;
		
			vec3 getIBLIrradiance( const in vec3 normal ) {
			 if(iblIrradianceDisabled) return vec3(0.);
			`
		)
	}

	if ("iblIrradianceDisabled" in ShaderLib.physical.uniforms)
		return ShaderLib.physical.uniforms["iblIrradianceDisabled"]

	const globalIblIrradianceDisabledUniform = {
		value: false
	}

	ShaderLib.physical.uniforms.iblIrradianceDisabled = globalIblIrradianceDisabledUniform

	const { clone } = UniformsUtils
	UniformsUtils.clone = uniforms => {
		const result = clone(uniforms)

		if ("iblIrradianceDisabled" in uniforms) {
			result.iblIrradianceDisabled = globalIblIrradianceDisabledUniform
		}

		return result
	}

	return globalIblIrradianceDisabledUniform
}

// source: https://github.com/mrdoob/three.js/blob/b9bc47ab1978022ab0947a9bce1b1209769b8d91/src/renderers/webgl/WebGLProgram.js#L228
// Unroll Loops

const unrollLoopPattern =
	/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g

export function unrollLoops(string) {
	return string.replace(unrollLoopPattern, loopReplacer)
}

function loopReplacer(match, start, end, snippet) {
	let string = ""

	for (let i = parseInt(start); i < parseInt(end); i++) {
		string += snippet.replace(/\[\s*i\s*\]/g, "[ " + i + " ]").replace(/UNROLLED_LOOP_INDEX/g, i)
	}

	return string
}

//

export const splitIntoGroupsOfVector4 = arr => {
	const result = []
	for (let i = 0; i < arr.length; i += 4) {
		result.push(new Vector4(...arr.slice(i, i + 4)))
	}
	return result
}

export const isGroundProjectedEnv = c => {
	return c.material.fragmentShader?.includes(
		"float intersection2 = diskIntersectWithBackFaceCulling( camPos, p, h, vec3( 0.0, 1.0, 0.0 ), radius );"
	)
}

export const isChildMaterialRenderable = (c, material = c.material) => {
	return (
		material.visible &&
		material.depthWrite &&
		material.depthTest &&
		(!material.transparent || material.opacity > 0) &&
		!isGroundProjectedEnv(c)
	)
}

const materialProps = [
	"vertexTangent",
	"vertexColors",
	"vertexAlphas",
	"vertexUvs",
	"uvsVertexOnly",
	"supportsVertexTextures",
	"instancing",
	"instancingColor",
	"side",
	"flatShading",
	"skinning",
	"doubleSided",
	"flipSided"
]

export const copyNecessaryProps = (originalMaterial, newMaterial) => {
	for (const props of materialProps) newMaterial[props] = originalMaterial[props]
}
