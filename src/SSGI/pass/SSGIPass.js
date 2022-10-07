import { DepthPass, Pass, RenderPass } from "postprocessing"
import {
	Color,
	HalfFloatType,
	LinearEncoding,
	LinearFilter,
	NearestFilter,
	RepeatWrapping,
	WebGLMultipleRenderTargets,
	WebGLRenderTarget
} from "three"
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js"
import { MRTMaterial } from "../material/MRTMaterial.js"
import { SSGIMaterial } from "../material/SSGIMaterial.js"
import { getVisibleChildren, isWebGL2Available } from "../utils/Utils.js"
import { UpscalePass } from "./UpscalePass.js"

const isWebGL2 = isWebGL2Available()
const backgroundColor = new Color(0)

export class SSGIPass extends Pass {
	cachedMaterials = new WeakMap()
	visibleMeshes = []

	constructor(ssgiEffect) {
		super("SSGIPass")

		this.ssgiEffect = ssgiEffect
		this._scene = ssgiEffect._scene
		this._camera = ssgiEffect._camera

		this.fullscreenMaterial = new SSGIMaterial()
		if (ssgiEffect._camera.isPerspectiveCamera) this.fullscreenMaterial.defines.PERSPECTIVE_CAMERA = ""

		this.renderTarget = new WebGLRenderTarget(1, 1, {
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			type: HalfFloatType,
			depthBuffer: false
		})

		this.renderPass = new RenderPass(this._scene, this._camera)

		// set up basic uniforms that we don't have to update
		this.fullscreenMaterial.uniforms.cameraMatrixWorld.value = this._camera.matrixWorld
		this.fullscreenMaterial.uniforms.projectionMatrix.value = this._camera.projectionMatrix
		this.fullscreenMaterial.uniforms.inverseProjectionMatrix.value = this._camera.projectionMatrixInverse

		const ktx2Loader = new KTX2Loader()
		ktx2Loader.setTranscoderPath("examples/js/libs/basis/")
		ktx2Loader.detectSupport(window.renderer)
		ktx2Loader.load("texture/blue_noise_rg.ktx2", blueNoiseTexture => {
			// generated using "toktx --target_type RG --t2 blue_noise_rg blue_noise_rg.png"
			blueNoiseTexture.minFilter = NearestFilter
			blueNoiseTexture.magFilter = NearestFilter
			blueNoiseTexture.wrapS = RepeatWrapping
			blueNoiseTexture.wrapT = RepeatWrapping
			blueNoiseTexture.encoding = LinearEncoding

			this.fullscreenMaterial.uniforms.blueNoiseTexture.value = blueNoiseTexture

			ktx2Loader.dispose()
		})

		this.upscalePass = new UpscalePass(this.renderTarget.texture)
	}

	initMRTRenderTarget() {
		if (this.gBuffersRenderTarget) this.gBuffersRenderTarget.dispose()
		if (this.webgl1DepthPass) this.webgl1DepthPass.dispose()
		if (this.diffuseRenderTarget) this.diffuseRenderTarget.dispose()

		this.renderVelocitySeparate = this.ssgiEffect.antialias

		if (isWebGL2) {
			let bufferCount = 3
			if (!this.renderVelocitySeparate) bufferCount++

			this.gBuffersRenderTarget = new WebGLMultipleRenderTargets(1, 1, bufferCount, {
				minFilter: NearestFilter,
				magFilter: NearestFilter
			})

			this.normalTexture = this.gBuffersRenderTarget.texture[1]
			this.depthTexture = this.gBuffersRenderTarget.texture[0]

			if (bufferCount > 2) this.diffuseTexture = this.gBuffersRenderTarget.texture[2]
		} else {
			// depth pass
			this.webgl1DepthPass = new DepthPass(this._scene, this._camera)

			// render normals (in the rgb channel) and roughness (in the alpha channel) in gBuffersRenderTarget
			this.gBuffersRenderTarget = new WebGLRenderTarget(1, 1, {
				minFilter: NearestFilter,
				magFilter: NearestFilter
			})

			this.normalTexture = this.gBuffersRenderTarget.texture
			this.depthTexture = this.webgl1DepthPass.texture
		}

		this.fullscreenMaterial.uniforms.normalTexture.value = this.normalTexture
		this.fullscreenMaterial.uniforms.depthTexture.value = this.depthTexture
		this.fullscreenMaterial.uniforms.velocityTexture.value = this.velocityTexture

		// set up uniforms
		this.ssgiEffect.temporalResolvePass.fullscreenMaterial.uniforms.diffuseTexture.value = this.diffuseTexture

		this.upscalePass.fullscreenMaterial.uniforms.depthTexture.value = this.depthTexture
		this.upscalePass.fullscreenMaterial.uniforms.normalTexture.value = this.normalTexture
	}

	get velocityTexture() {
		if (this.renderVelocitySeparate) return this.ssgiEffect.temporalResolvePass.velocityPass.texture

		return this.gBuffersRenderTarget.texture[3]
	}

	setSize(width, height) {
		this.initMRTRenderTarget()

		this.renderTarget.setSize(width * this.ssgiEffect.resolutionScale, height * this.ssgiEffect.resolutionScale)
		this.gBuffersRenderTarget.setSize(width, height)
		if (this.diffuseRenderTarget) this.diffuseRenderTarget.setSize(width, height)

		this.upscalePass.setSize(width, height)
		this.upscalePass.fullscreenMaterial.uniforms.invTexSize.value.set(
			1 / this.gBuffersRenderTarget.width,
			1 / this.gBuffersRenderTarget.height
		)

		// setting the size for the webgl1DepthPass currently causes a stack overflow due to recursive calling
		if (!isWebGL2) {
			this.webgl1DepthPass.renderTarget.setSize(
				width * this.ssgiEffect.resolutionScale,
				height * this.ssgiEffect.resolutionScale
			)
		}

		this.fullscreenMaterial.uniforms.invTexSize.value.set(1 / width, 1 / height)

		this.fullscreenMaterial.uniforms.accumulatedTexture.value = this.ssgiEffect.temporalResolvePass.renderTarget.texture

		this.fullscreenMaterial.needsUpdate = true
	}

	dispose() {
		this.renderTarget.dispose()
		this.gBuffersRenderTarget.dispose()
		this.renderPass.dispose()
		if (!isWebGL2) this.webgl1DepthPass.dispose()

		this.fullscreenMaterial.dispose()

		this.normalTexture = null
		this.depthTexture = null
		this.diffuseTexture = null
	}

	keepMaterialMapUpdated(mrtMaterial, originalMaterial, prop, define, useKey) {
		if (useKey === true || this.ssgiEffect[useKey]) {
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

	setMRTMaterialInScene() {
		this.visibleMeshes = getVisibleChildren(this._scene)

		for (const c of this.visibleMeshes) {
			c.visible = c.material.visible && c.material.colorWrite

			const originalMaterial = c.material

			let [cachedOriginalMaterial, mrtMaterial] = this.cachedMaterials.get(c) || []

			if (originalMaterial !== cachedOriginalMaterial) {
				if (mrtMaterial) mrtMaterial.dispose()

				mrtMaterial = new MRTMaterial()

				if (isWebGL2) mrtMaterial.defines.isWebGL2 = ""

				mrtMaterial.normalScale = originalMaterial.normalScale
				mrtMaterial.uniforms.normalScale.value = originalMaterial.normalScale

				const map =
					originalMaterial.map ||
					originalMaterial.normalMap ||
					originalMaterial.roughnessMap ||
					originalMaterial.metalnessMap

				if (map) mrtMaterial.uniforms.uvTransform.value = map.matrix

				this.cachedMaterials.set(c, [originalMaterial, mrtMaterial])
			}

			// to ensure SSGI works as good as possible in the scene
			originalMaterial.envMapIntensity = 0

			// update the child's MRT material
			this.keepMaterialMapUpdated(mrtMaterial, originalMaterial, "normalMap", "USE_NORMAL_MAP", "useNormalMap")
			this.keepMaterialMapUpdated(mrtMaterial, originalMaterial, "roughnessMap", "USE_ROUGHNESS_MAP", "useRoughnessMap")
			this.keepMaterialMapUpdated(mrtMaterial, originalMaterial, "map", "USE_MAP", true)

			if ("renderVelocity" in mrtMaterial.defines) {
				if (this.renderVelocitySeparate) {
					delete mrtMaterial.defines.renderVelocity
					mrtMaterial.needsUpdate = true
				}
			} else if (!this.renderVelocitySeparate) {
				mrtMaterial.defines.renderVelocity = ""
				mrtMaterial.needsUpdate = true
			}

			if (c.skeleton?.boneTexture) {
				mrtMaterial.defines.USE_SKINNING = ""
				mrtMaterial.defines.BONE_TEXTURE = ""

				mrtMaterial.uniforms.boneTexture.value = c.skeleton.boneTexture
			}

			mrtMaterial.uniforms.roughness.value =
				this.ssgiEffect.selection.size === 0 || this.ssgiEffect.selection.has(c)
					? originalMaterial.roughness || 0
					: 10e10

			c.material = mrtMaterial

			if (!this.renderVelocitySeparate)
				this.ssgiEffect.temporalResolvePass.velocityPass.updateVelocityMaterialBeforeRender(c, originalMaterial)
		}
	}

	unsetMRTMaterialInScene() {
		for (const c of this.visibleMeshes) {
			// set material back to the original one
			const [originalMaterial] = this.cachedMaterials.get(c)

			if (!this.renderVelocitySeparate)
				this.ssgiEffect.temporalResolvePass.velocityPass.updateVelocityMaterialAfterRender(c)

			c.material = originalMaterial
		}
	}

	render(renderer) {
		const { background } = this._scene

		this._scene.background = backgroundColor

		this.setMRTMaterialInScene()

		this.renderPass.render(renderer, this.gBuffersRenderTarget)

		this.unsetMRTMaterialInScene()

		if (!isWebGL2) this.webgl1DepthPass.renderPass.render(renderer, this.webgl1DepthPass.renderTarget)

		this.fullscreenMaterial.uniforms.samples.value = this.ssgiEffect.temporalResolvePass.samples
		this.fullscreenMaterial.uniforms.time.value = (performance.now() % (10 * 60 * 1000)) * 0.01
		this.fullscreenMaterial.uniforms.cameraNear.value = this._camera.near
		this.fullscreenMaterial.uniforms.cameraFar.value = this._camera.far

		this.fullscreenMaterial.uniforms.viewMatrix.value.copy(this._camera.matrixWorldInverse)

		const noiseTexture = this.fullscreenMaterial.uniforms.blueNoiseTexture.value
		if (noiseTexture) {
			const { width, height } = noiseTexture.source.data

			// a factor of 4 seems to get the best results when comparing different factors
			this.fullscreenMaterial.uniforms.blueNoiseRepeat.value.set(
				(4 * this.ssgiEffect.temporalResolvePass.renderTarget.width) / width,
				(4 * this.ssgiEffect.temporalResolvePass.renderTarget.height) / height
			)
		}

		this._scene.background = background

		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)

		if (this.upscalePass.iterations > 0) {
			this.upscalePass.render(renderer)
			this.ssgiEffect.temporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value = this.upscalePass.texture
		} else {
			this.ssgiEffect.temporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value = this.renderTarget.texture
		}
	}
}
