import { Pass } from "postprocessing"
import {
	Color,
	HalfFloatType,
	LinearEncoding,
	LinearFilter,
	NearestFilter,
	RepeatWrapping,
	sRGBEncoding,
	TextureLoader,
	WebGLMultipleRenderTargets
} from "three"
import { MRTMaterial } from "../material/MRTMaterial.js"
import { SSGIMaterial } from "../material/SSGIMaterial.js"
import { generateHalton23Points } from "../temporal-resolve/utils/generateHalton23Points.js"
import { getVisibleChildren, keepMaterialMapUpdated } from "../utils/Utils.js"

const backgroundColor = new Color(0)
const points = generateHalton23Points(2 ** 16)
export class SSGIPass extends Pass {
	cachedMaterials = new WeakMap()
	visibleMeshes = []
	haltonIndex = 0

	constructor(ssgiEffect) {
		super("SSGIPass")

		this.ssgiEffect = ssgiEffect
		this._scene = ssgiEffect._scene
		this._camera = ssgiEffect._camera

		this.fullscreenMaterial = new SSGIMaterial()

		this.renderTarget = new WebGLMultipleRenderTargets(1, 1, 2, {
			type: HalfFloatType,
			depthBuffer: false
		})

		// set up basic uniforms that we don't have to update
		this.fullscreenMaterial.uniforms.cameraMatrixWorld.value = this._camera.matrixWorld
		this.fullscreenMaterial.uniforms.viewMatrix.value = this._camera.matrixWorldInverse
		this.fullscreenMaterial.uniforms.projectionMatrix.value = this._camera.projectionMatrix
		this.fullscreenMaterial.uniforms.inverseProjectionMatrix.value = this._camera.projectionMatrixInverse
		this.fullscreenMaterial.uniforms.cameraPos.value = this._camera.position

		if (ssgiEffect._camera.isPerspectiveCamera) this.fullscreenMaterial.defines.PERSPECTIVE_CAMERA = ""
		if (ssgiEffect.reflectionsOnly) this.fullscreenMaterial.defines.reflectionsOnly = ""

		this.initMRTRenderTarget()
	}

	initialize(renderer, ...args) {
		super.initialize(renderer, ...args)

		new TextureLoader().load("texture/blue_noise_3channels_256.png", blueNoiseTexture => {
			blueNoiseTexture.minFilter = NearestFilter
			blueNoiseTexture.magFilter = NearestFilter
			blueNoiseTexture.wrapS = RepeatWrapping
			blueNoiseTexture.wrapT = RepeatWrapping
			blueNoiseTexture.encoding = LinearEncoding

			this.fullscreenMaterial.uniforms.blueNoiseTexture.value = blueNoiseTexture
		})
	}

	get texture() {
		return this.renderTarget.texture[0]
	}

	get specularTexture() {
		return this.renderTarget.texture[1]
	}

	initMRTRenderTarget() {
		this.gBuffersRenderTarget = new WebGLMultipleRenderTargets(1, 1, 4, {
			minFilter: NearestFilter,
			magFilter: NearestFilter
		})

		this.depthTexture = this.gBuffersRenderTarget.texture[0]
		this.normalTexture = this.gBuffersRenderTarget.texture[1]
		this.diffuseTexture = this.gBuffersRenderTarget.texture[2]
		this.emissiveTexture = this.gBuffersRenderTarget.texture[3]

		this.diffuseTexture.minFilter = LinearFilter
		this.diffuseTexture.magFilter = LinearFilter
		this.diffuseTexture.encoding = sRGBEncoding
		this.diffuseTexture.needsUpdate = true

		this.emissiveTexture.minFilter = LinearFilter
		this.emissiveTexture.magFilter = LinearFilter
		this.emissiveTexture.encoding = sRGBEncoding
		this.emissiveTexture.needsUpdate = true

		this.normalTexture.type = HalfFloatType
		this.normalTexture.needsUpdate = true

		this.fullscreenMaterial.uniforms.normalTexture.value = this.normalTexture
		this.fullscreenMaterial.uniforms.depthTexture.value = this.depthTexture
		this.fullscreenMaterial.uniforms.diffuseTexture.value = this.diffuseTexture
		this.fullscreenMaterial.uniforms.emissiveTexture.value = this.emissiveTexture
	}

	setSize(width, height) {
		this.renderTarget.setSize(width * this.ssgiEffect.resolutionScale, height * this.ssgiEffect.resolutionScale)
		this.gBuffersRenderTarget.setSize(width, height)

		this.fullscreenMaterial.uniforms.invTexSize.value.set(1 / width, 1 / height)
	}

	dispose() {
		this.renderTarget.dispose()
		this.gBuffersRenderTarget.dispose()

		this.normalTexture = null
		this.depthTexture = null
		this.diffuseTexture = null
		this.emissiveTexture = null
	}

	setMRTMaterialInScene() {
		this.visibleMeshes = getVisibleChildren(this._scene)

		for (const c of this.visibleMeshes) {
			const originalMaterial = c.material

			let [cachedOriginalMaterial, mrtMaterial] = this.cachedMaterials.get(c) || []

			if (originalMaterial !== cachedOriginalMaterial) {
				if (mrtMaterial) mrtMaterial.dispose()

				mrtMaterial = new MRTMaterial()
				if (originalMaterial.emissive) mrtMaterial.uniforms.emissive.value = originalMaterial.emissive
				if (originalMaterial.color) mrtMaterial.uniforms.color.value = originalMaterial.color

				mrtMaterial.uniforms.normalScale.value = originalMaterial.normalScale

				if (c.skeleton?.boneTexture) {
					mrtMaterial.defines.USE_SKINNING = ""
					mrtMaterial.defines.BONE_TEXTURE = ""

					mrtMaterial.uniforms.boneTexture.value = c.skeleton.boneTexture

					mrtMaterial.needsUpdate = true
				}

				this.cachedMaterials.set(c, [originalMaterial, mrtMaterial])
			}

			const map =
				originalMaterial.map ||
				originalMaterial.normalMap ||
				originalMaterial.roughnessMap ||
				originalMaterial.metalnessMap

			if (map) mrtMaterial.uniforms.uvTransform.value = map.matrix
			mrtMaterial.side = originalMaterial.side

			// to ensure SSGI works as good as possible in the scene
			if (!this.ssgiEffect.reflectionsOnly) {
				mrtMaterial.envMapIntensity = originalMaterial.envMapIntensity
				originalMaterial.envMapIntensity = 0
			}

			// update the child's MRT material
			keepMaterialMapUpdated(mrtMaterial, originalMaterial, "normalMap", "USE_NORMALMAP", true)
			keepMaterialMapUpdated(mrtMaterial, originalMaterial, "roughnessMap", "USE_ROUGHNESSMAP", true)
			keepMaterialMapUpdated(mrtMaterial, originalMaterial, "metalnessMap", "USE_	METALNESSMAP", true)
			keepMaterialMapUpdated(mrtMaterial, originalMaterial, "map", "USE_MAP", true)
			keepMaterialMapUpdated(mrtMaterial, originalMaterial, "emissiveMap", "USE_EMISSIVEMAP", true)

			const visible = originalMaterial.visible && c.constructor.name !== "GroundProjectedEnv"
			c.visible &&= visible

			mrtMaterial.uniforms.roughness.value =
				this.ssgiEffect.selection.size === 0 || this.ssgiEffect.selection.has(c)
					? originalMaterial.roughness || 0
					: 10e10

			mrtMaterial.uniforms.metalness.value = c.material.metalness || 0
			mrtMaterial.uniforms.emissiveIntensity.value = c.material.emissiveIntensity || 0
			c.material = mrtMaterial
		}
	}

	unsetMRTMaterialInScene() {
		for (const c of this.visibleMeshes) {
			c.visible = true

			// set material back to the original one
			const [originalMaterial] = this.cachedMaterials.get(c)

			if (!this.ssgiEffect.reflectionsOnly) originalMaterial.envMapIntensity = c.material.envMapIntensity

			c.material = originalMaterial
		}
	}

	render(renderer) {
		const { background } = this._scene

		this._scene.background = backgroundColor

		this.setMRTMaterialInScene()

		renderer.setRenderTarget(this.gBuffersRenderTarget)
		renderer.render(this._scene, this._camera)

		this.unsetMRTMaterialInScene()

		// update uniforms
		this.haltonIndex = (this.haltonIndex + 1) % points.length
		this.fullscreenMaterial.uniforms.blueNoiseOffset.value.fromArray(points[this.haltonIndex])
		this.fullscreenMaterial.uniforms.cameraNear.value = this._camera.near
		this.fullscreenMaterial.uniforms.cameraFar.value = this._camera.far
		this.fullscreenMaterial.uniforms.viewMatrix.value.copy(this._camera.matrixWorldInverse)
		this.fullscreenMaterial.uniforms.accumulatedTexture.value = this.ssgiEffect.svgf.denoisePass.texture

		const noiseTexture = this.fullscreenMaterial.uniforms.blueNoiseTexture.value
		if (noiseTexture) {
			const { width, height } = noiseTexture.source.data

			this.fullscreenMaterial.uniforms.blueNoiseRepeat.value.set(
				this.renderTarget.width / width,
				this.renderTarget.height / height
			)
		}

		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)

		this._scene.background = background
	}
}
