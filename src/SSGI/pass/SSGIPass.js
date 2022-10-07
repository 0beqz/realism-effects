import { DepthPass, Pass, RenderPass } from "postprocessing"
import {
	Color,
	HalfFloatType,
	LinearEncoding,
	LinearFilter,
	MeshBasicMaterial,
	NearestFilter,
	RepeatWrapping,
	sRGBEncoding,
	WebGLMultipleRenderTargets,
	WebGLRenderTarget
} from "three"
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js"
import { MRTMaterial } from "../material/MRTMaterial.js"
import { SSGIMaterial } from "../material/SSGIMaterial.js"
import { getVisibleChildren, isWebGL2Available } from "../utils/Utils.js"
import { UpscalePass } from "./UpscalePass.js"

const isWebGL2 = isWebGL2Available()
const rendererClearColor = new Color()

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
		this.fullscreenMaterial.uniforms.velocityTexture.value = this.ssgiEffect.temporalResolvePass.velocityPass.texture

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
		})

		this.upscalePass = new UpscalePass()
		this.upscalePass2 = new UpscalePass({ horizontal: false })

		// set the upscale passes' input textures
		this.upscalePass.fullscreenMaterial.uniforms.inputTexture.value = this.renderTarget.texture
		this.upscalePass2.fullscreenMaterial.uniforms.inputTexture.value = this.upscalePass.renderTarget.texture
	}

	initMRTRenderTarget() {
		if (this.gBuffersRenderTarget) this.gBuffersRenderTarget.dispose()
		if (this.webgl1DepthPass) this.webgl1DepthPass.dispose()
		if (this.diffuseRenderTarget) this.diffuseRenderTarget.dispose()

		this.renderDiffuseSeparate = this.ssgiEffect.resolutionScale < 1

		if (isWebGL2) {
			const bufferCount = this.renderDiffuseSeparate ? 2 : 3

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

		if (this.renderDiffuseSeparate) {
			this.diffuseRenderTarget = new WebGLRenderTarget(1, 1, {
				minFilter: NearestFilter,
				magFilter: NearestFilter,
				encoding: sRGBEncoding
			})

			this.diffuseTexture = this.diffuseRenderTarget.texture
		} else {
			this.diffuseRenderTarget = null
		}

		this.fullscreenMaterial.uniforms.normalTexture.value = this.normalTexture
		this.fullscreenMaterial.uniforms.depthTexture.value = this.depthTexture

		// set up uniforms
		this.ssgiEffect.temporalResolvePass.fullscreenMaterial.uniforms.diffuseTexture.value = this.diffuseTexture

		this.upscalePass.fullscreenMaterial.uniforms.depthTexture.value = this.depthTexture
		this.upscalePass2.fullscreenMaterial.uniforms.depthTexture.value = this.depthTexture
		this.upscalePass.fullscreenMaterial.uniforms.normalTexture.value = this.normalTexture
		this.upscalePass2.fullscreenMaterial.uniforms.normalTexture.value = this.normalTexture

		this.ssgiEffect.temporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value =
			this.upscalePass2.renderTarget.texture
	}

	setSize(width, height) {
		this.initMRTRenderTarget()

		this.renderTarget.setSize(width * this.ssgiEffect.resolutionScale, height * this.ssgiEffect.resolutionScale)
		this.gBuffersRenderTarget.setSize(width * this.ssgiEffect.resolutionScale, height * this.ssgiEffect.resolutionScale)
		if (this.diffuseRenderTarget) this.diffuseRenderTarget.setSize(width, height)

		this.upscalePass.setSize(width, height)
		this.upscalePass.fullscreenMaterial.uniforms.invTexSize.value.set(
			1 / this.gBuffersRenderTarget.width,
			1 / this.gBuffersRenderTarget.height
		)
		this.upscalePass2.setSize(width, height)
		this.upscalePass2.fullscreenMaterial.uniforms.invTexSize.value.set(
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

			let [cachedOriginalMaterial, mrtMaterial, diffuseMaterial] = this.cachedMaterials.get(c) || []

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

				diffuseMaterial = new MeshBasicMaterial({
					toneMapped: false
				})

				this.cachedMaterials.set(c, [originalMaterial, mrtMaterial, diffuseMaterial])
			}

			// to ensure SSGI works as good as possible in the scene
			originalMaterial.envMapIntensity = 0

			// update the child's MRT material
			this.keepMaterialMapUpdated(mrtMaterial, originalMaterial, "normalMap", "USE_NORMAL_MAP", "useNormalMap")
			this.keepMaterialMapUpdated(mrtMaterial, originalMaterial, "roughnessMap", "USE_ROUGHNESS_MAP", "useRoughnessMap")
			this.keepMaterialMapUpdated(mrtMaterial, originalMaterial, "map", "USE_MAP", true)

			if ("renderDiffuse" in mrtMaterial.defines) {
				if (this.renderDiffuseSeparate) {
					delete mrtMaterial.defines.renderDiffuse
					mrtMaterial.needsUpdate = true
				}
			} else if (!this.renderDiffuseSeparate) {
				mrtMaterial.defines.renderDiffuse = ""
				mrtMaterial.needsUpdate = true
			}

			if (c.skeleton?.boneTexture) {
				mrtMaterial.defines.USE_SKINNING = ""
				mrtMaterial.defines.BONE_TEXTURE = ""

				mrtMaterial.uniforms.boneTexture.value = c.skeleton.boneTexture
			}

			if (originalMaterial.map) {
				diffuseMaterial.map = originalMaterial.map
			}

			if (originalMaterial.color) {
				diffuseMaterial.color = originalMaterial.color
				mrtMaterial.uniforms.color.value = originalMaterial.color
			}

			diffuseMaterial.visible = originalMaterial.visible

			mrtMaterial.uniforms.roughness.value =
				this.ssgiEffect.selection.size === 0 || this.ssgiEffect.selection.has(c)
					? originalMaterial.roughness || 0
					: 10e10

			c.material = mrtMaterial
		}
	}

	unsetMRTMaterialInScene() {
		for (const c of this.visibleMeshes) {
			// set material back to the original one
			const [originalMaterial] = this.cachedMaterials.get(c)

			c.material = originalMaterial
		}
	}

	setDiffuseMaterialInScene() {
		for (const c of this.visibleMeshes) {
			c.visible = c.material.visible && c.material.colorWrite

			c.material = this.cachedMaterials.get(c)[2]
		}
	}

	unsetDiffuseMaterialInScene() {
		for (const c of this.visibleMeshes) {
			// set material back to the original one
			const [originalMaterial] = this.cachedMaterials.get(c)

			c.visible = true

			c.material = originalMaterial
		}
	}

	render(renderer) {
		renderer.getClearColor(rendererClearColor)
		renderer.setClearColor(0)

		this.setMRTMaterialInScene()

		this.renderPass.render(renderer, this.gBuffersRenderTarget)

		this.unsetMRTMaterialInScene()

		if (this.renderDiffuseSeparate) {
			this.setDiffuseMaterialInScene()
			this.renderPass.render(renderer, this.diffuseRenderTarget)
			this.unsetDiffuseMaterialInScene()
		}

		// render depth and velocity in seperate passes
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

		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)

		renderer.setClearColor(rendererClearColor)

		this.upscalePass.render(renderer)
		this.upscalePass2.render(renderer)
	}
}
