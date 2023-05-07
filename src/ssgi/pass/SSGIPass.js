import { Pass } from "postprocessing"
import {
	Color,
	DepthTexture,
	FloatType,
	HalfFloatType,
	LinearEncoding,
	LinearFilter,
	NearestFilter,
	RepeatWrapping,
	sRGBEncoding,
	Texture,
	TextureLoader,
	WebGLMultipleRenderTargets
} from "three"
import { MRTMaterial } from "../material/MRTMaterial.js"
import { SSGIMaterial } from "../material/SSGIMaterial.js"
import {
	copyNecessaryProps,
	getVisibleChildren,
	isChildMaterialRenderable,
	keepMaterialMapUpdated
} from "../utils/Utils"
import { BackSideDepthPass } from "./BackSideDepthPass"

import blueNoiseImage from "./../../utils/LDR_RGBA_0.png"

const backgroundColor = new Color(0)

export class SSGIPass extends Pass {
	needsSwap = false
	defaultFragmentShader = ""

	frame = 0
	cachedMaterials = new WeakMap()
	visibleMeshes = []

	constructor(ssgiEffect, options) {
		super("SSGIPass")

		this.ssgiEffect = ssgiEffect
		this._scene = ssgiEffect._scene
		this._camera = ssgiEffect._camera

		this.fullscreenMaterial = new SSGIMaterial()
		this.defaultFragmentShader = this.fullscreenMaterial.fragmentShader

		const bufferCount = !options.diffuseOnly && !options.specularOnly ? 2 : 1

		this.renderTarget = new WebGLMultipleRenderTargets(1, 1, bufferCount, {
			type: HalfFloatType,
			depthBuffer: false
		})

		// set up basic uniforms that we don't have to update
		this.fullscreenMaterial.uniforms.cameraMatrixWorld.value = this._camera.matrixWorld
		this.fullscreenMaterial.uniforms.viewMatrix.value = this._camera.matrixWorldInverse
		this.fullscreenMaterial.uniforms.projectionMatrix.value = this._camera.projectionMatrix
		this.fullscreenMaterial.uniforms.inverseProjectionMatrix.value = this._camera.projectionMatrixInverse

		if (ssgiEffect._camera.isPerspectiveCamera) this.fullscreenMaterial.defines.PERSPECTIVE_CAMERA = ""

		if (options.diffuseOnly) this.fullscreenMaterial.defines.diffuseOnly = ""
		if (options.specularOnly) this.fullscreenMaterial.defines.specularOnly = ""

		this.initMRTRenderTarget()
	}

	initialize(renderer, ...args) {
		super.initialize(renderer, ...args)

		new TextureLoader().load(blueNoiseImage, blueNoiseTexture => {
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
		const index = "specularOnly" in this.fullscreenMaterial.defines ? 0 : 1
		return this.renderTarget.texture[index]
	}

	initMRTRenderTarget() {
		this.gBuffersRenderTarget = new WebGLMultipleRenderTargets(1, 1, 4, {
			minFilter: NearestFilter,
			magFilter: NearestFilter
		})

		this.gBuffersRenderTarget.depthTexture = new DepthTexture(1, 1)
		this.gBuffersRenderTarget.depthTexture.type = FloatType

		this.backSideDepthPass = new BackSideDepthPass(this._scene, this._camera)

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
		this.emissiveTexture.type = HalfFloatType
		this.emissiveTexture.needsUpdate = true

		this.normalTexture.type = HalfFloatType
		this.normalTexture.needsUpdate = true

		this.fullscreenMaterial.uniforms.normalTexture.value = this.normalTexture
		this.fullscreenMaterial.uniforms.depthTexture.value = this.depthTexture
		this.fullscreenMaterial.uniforms.diffuseTexture.value = this.diffuseTexture
		this.fullscreenMaterial.uniforms.emissiveTexture.value = this.emissiveTexture
		this.fullscreenMaterial.uniforms.backSideDepthTexture.value = this.backSideDepthPass.renderTarget.texture
	}

	setSize(width, height) {
		this.renderTarget.setSize(width * this.ssgiEffect.resolutionScale, height * this.ssgiEffect.resolutionScale)
		this.gBuffersRenderTarget.setSize(width, height)
		this.backSideDepthPass.setSize(width, height)

		this.fullscreenMaterial.uniforms.texSize.value.set(this.renderTarget.width, this.renderTarget.height)
	}

	dispose() {
		super.dispose()

		this.renderTarget.dispose()
		this.gBuffersRenderTarget.dispose()
		this.backSideDepthPass.dispose()

		this.fullscreenMaterial.dispose()

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

				copyNecessaryProps(originalMaterial, mrtMaterial)

				mrtMaterial.uniforms.normalScale.value = originalMaterial.normalScale

				if (c.skeleton?.boneTexture) {
					mrtMaterial.defines.USE_SKINNING = ""
					mrtMaterial.defines.BONE_TEXTURE = ""

					mrtMaterial.uniforms.boneTexture.value = c.skeleton.boneTexture

					mrtMaterial.needsUpdate = true
				}

				const textureKey = Object.keys(originalMaterial).find(key => {
					const value = originalMaterial[key]
					return value instanceof Texture && value.matrix
				})

				if (textureKey) mrtMaterial.uniforms.uvTransform.value = originalMaterial[textureKey].matrix

				this.cachedMaterials.set(c, [originalMaterial, mrtMaterial])
			}

			if (originalMaterial.emissive) mrtMaterial.uniforms.emissive.value = originalMaterial.emissive
			if (originalMaterial.color) mrtMaterial.uniforms.color.value = originalMaterial.color

			// update the child's MRT material
			keepMaterialMapUpdated(mrtMaterial, originalMaterial, "normalMap", "USE_NORMALMAP", true)
			keepMaterialMapUpdated(mrtMaterial, originalMaterial, "roughnessMap", "USE_ROUGHNESSMAP", true)
			keepMaterialMapUpdated(mrtMaterial, originalMaterial, "metalnessMap", "USE_	METALNESSMAP", true)
			keepMaterialMapUpdated(mrtMaterial, originalMaterial, "map", "USE_MAP", true)
			keepMaterialMapUpdated(mrtMaterial, originalMaterial, "emissiveMap", "USE_EMISSIVEMAP", true)
			keepMaterialMapUpdated(mrtMaterial, originalMaterial, "alphaMap", "USE_ALPHAMAP", true)

			const noiseTexture = this.fullscreenMaterial.uniforms.blueNoiseTexture.value
			if (noiseTexture) {
				const { width, height } = noiseTexture.source.data
				mrtMaterial.uniforms.blueNoiseTexture.value = noiseTexture
				mrtMaterial.uniforms.blueNoiseRepeat.value.set(
					this.renderTarget.width / width,
					this.renderTarget.height / height
				)
			}
			mrtMaterial.uniforms.texSize.value.set(this.renderTarget.width, this.renderTarget.height)
			mrtMaterial.uniforms.frame.value = this.frame

			c.visible = isChildMaterialRenderable(c, originalMaterial)

			const origRoughness = originalMaterial.roughness ?? 1

			mrtMaterial.uniforms.roughness.value =
				this.ssgiEffect.selection.size === 0 || this.ssgiEffect.selection.has(c) ? origRoughness : 10e10

			mrtMaterial.uniforms.metalness.value = c.material.metalness ?? 0
			mrtMaterial.uniforms.emissiveIntensity.value = c.material.emissiveIntensity ?? 0

			c.material = mrtMaterial
		}
	}

	unsetMRTMaterialInScene() {
		for (const c of this.visibleMeshes) {
			c.visible = true

			// set material back to the original one
			const [originalMaterial] = this.cachedMaterials.get(c)

			c.material = originalMaterial
		}
	}

	render(renderer) {
		this.frame = (this.frame + this.ssgiEffect.spp) % 65536

		const { background } = this._scene

		this._scene.background = backgroundColor

		this.setMRTMaterialInScene()

		renderer.setRenderTarget(this.gBuffersRenderTarget)
		renderer.render(this._scene, this._camera)

		this.unsetMRTMaterialInScene()

		if (this.ssgiEffect.autoThickness) this.backSideDepthPass.render(renderer)

		// update uniforms
		this.fullscreenMaterial.uniforms.frame.value = this.frame
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
