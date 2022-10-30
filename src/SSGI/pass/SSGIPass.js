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
import { getVisibleChildren, isWebGL2Available, keepMaterialMapUpdated } from "../utils/Utils.js"

const isWebGL2 = isWebGL2Available()
const backgroundColor = new Color(0)

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
		this.fullscreenMaterial.uniforms.cameraMatrixWorldInverse.value = this._camera.matrixWorldInverse
		this.fullscreenMaterial.uniforms.projectionMatrix.value = this._camera.projectionMatrix
		this.fullscreenMaterial.uniforms.inverseProjectionMatrix.value = this._camera.projectionMatrixInverse
	}

	initialize(renderer, ...args) {
		super.initialize(renderer, ...args)
		const ktx2Loader = new KTX2Loader()
		ktx2Loader.setTranscoderPath("examples/js/libs/basis/")
		ktx2Loader.detectSupport(renderer)
		ktx2Loader.load("texture/blue_noise_rg.ktx2", blueNoiseTexture => {
			// generated using "toktx --target_type RG --t2 blue_noise_rg blue_noise_rg.png"
			blueNoiseTexture.minFilter = LinearFilter
			blueNoiseTexture.wrapS = RepeatWrapping
			blueNoiseTexture.wrapT = RepeatWrapping
			blueNoiseTexture.encoding = LinearEncoding

			this.fullscreenMaterial.uniforms.blueNoiseTexture.value = blueNoiseTexture

			ktx2Loader.dispose()
		})
	}

	initMRTRenderTarget() {
		if (this.gBuffersRenderTarget) this.gBuffersRenderTarget.dispose()
		this.webgl1DepthPass?.dispose()
		this.diffuseRenderTarget?.dispose()

		this.renderVelocitySeparate = !isWebGL2 || this.ssgiEffect.antialias

		if (isWebGL2) {
			let bufferCount = 3
			if (!this.renderVelocitySeparate) bufferCount++

			this.gBuffersRenderTarget = new WebGLMultipleRenderTargets(1, 1, bufferCount, {
				minFilter: NearestFilter,
				magFilter: NearestFilter
			})

			this.depthTexture = this.gBuffersRenderTarget.texture[0]
			this.normalTexture = this.gBuffersRenderTarget.texture[1]
			this.diffuseTexture = this.gBuffersRenderTarget.texture[2]
		} else {
			// depth pass
			this.webgl1DepthPass = new DepthPass(this._scene, this._camera)

			// render normals (in the rgb channel) and roughness (in the alpha channel) in gBuffersRenderTarget
			this.gBuffersRenderTarget = new WebGLRenderTarget(1, 1, {
				minFilter: NearestFilter,
				magFilter: NearestFilter
			})

			this.diffuseRenderTarget = new WebGLRenderTarget(1, 1, {
				minFilter: LinearFilter,
				magFilter: LinearFilter,
				encoding: sRGBEncoding
			})

			this.normalTexture = this.gBuffersRenderTarget.texture
			this.depthTexture = this.webgl1DepthPass.texture
			this.diffuseTexture = this.diffuseRenderTarget.texture
		}

		this.fullscreenMaterial.uniforms.normalTexture.value = this.normalTexture
		this.fullscreenMaterial.uniforms.depthTexture.value = this.depthTexture
		this.fullscreenMaterial.uniforms.diffuseTexture.value = this.diffuseTexture
		this.fullscreenMaterial.uniforms.velocityTexture.value = this.velocityTexture

		// set up uniforms
		this.ssgiEffect.svgf.svgfTemporalResolvePass.fullscreenMaterial.uniforms.diffuseTexture.value = this.diffuseTexture

		this.ssgiEffect.svgf.setNormalTexture(this.normalTexture)
		this.ssgiEffect.svgf.setDepthTexture(this.depthTexture)

		this.ssgiEffect.svgf.svgfTemporalResolvePass.fullscreenMaterial.uniforms.velocityTexture.value =
			this.velocityTexture
	}

	get velocityTexture() {
		if (this.renderVelocitySeparate) return this.ssgiEffect.svgf.svgfTemporalResolvePass.velocityPass.texture

		return this.gBuffersRenderTarget.texture[3]
	}

	setSize(width, height) {
		this.initMRTRenderTarget()

		this.renderTarget.setSize(width * this.ssgiEffect.resolutionScale, height * this.ssgiEffect.resolutionScale)
		this.gBuffersRenderTarget.setSize(width, height)
		if (this.diffuseRenderTarget) this.diffuseRenderTarget.setSize(width, height)

		// setting the size for the webgl1DepthPass currently causes a stack overflow due to recursive calling
		if (!isWebGL2) {
			this.webgl1DepthPass.renderTarget.setSize(
				width * this.ssgiEffect.resolutionScale,
				height * this.ssgiEffect.resolutionScale
			)
		}

		this.fullscreenMaterial.uniforms.invTexSize.value.set(1 / width, 1 / height)

		this.fullscreenMaterial.uniforms.accumulatedTexture.value = this.ssgiEffect.svgf.svgfTemporalResolvePass.texture

		this.fullscreenMaterial.needsUpdate = true
	}

	dispose() {
		this.renderTarget.dispose()
		this.gBuffersRenderTarget.dispose()
		this.renderPass.dispose()
		this.webgl1DepthPass?.dispose()
		this.diffuseRenderTarget?.dispose()

		this.fullscreenMaterial.dispose()

		this.normalTexture = null
		this.depthTexture = null
		this.diffuseTexture = null
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
			if (!this.ssgiEffect.reflectionsOnly) originalMaterial.envMapIntensity = 0

			// update the child's MRT material
			keepMaterialMapUpdated(mrtMaterial, originalMaterial, "normalMap", "USE_NORMAL_MAP", true)
			keepMaterialMapUpdated(mrtMaterial, originalMaterial, "roughnessMap", "USE_ROUGHNESS_MAP", true)
			keepMaterialMapUpdated(mrtMaterial, originalMaterial, "metalnessMap", "USE_	METALNESS_MAP", true)
			keepMaterialMapUpdated(mrtMaterial, originalMaterial, "map", "USE_MAP", true)

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

			if (originalMaterial.map) {
				diffuseMaterial.map = originalMaterial.map
			}

			if (originalMaterial.color) {
				diffuseMaterial.color = originalMaterial.color
				mrtMaterial.uniforms.color.value = originalMaterial.color
			}

			const visible = originalMaterial.visible && !c.constructor.name.includes("GroundProjectedEnv")
			c.visible = visible

			mrtMaterial.uniforms.roughness.value =
				this.ssgiEffect.selection.size === 0 || this.ssgiEffect.selection.has(c)
					? originalMaterial.roughness || 0
					: 10e10

			mrtMaterial.uniforms.metalness.value = c.material.metalness || 0
			c.material = mrtMaterial

			if (!this.renderVelocitySeparate)
				this.ssgiEffect.svgf.svgfTemporalResolvePass.velocityPass.updateVelocityMaterialBeforeRender(
					c,
					originalMaterial
				)
		}
	}

	unsetMRTMaterialInScene() {
		for (const c of this.visibleMeshes) {
			c.visible = true

			// set material back to the original one
			const [originalMaterial] = this.cachedMaterials.get(c)

			if (!this.renderVelocitySeparate)
				this.ssgiEffect.svgf.svgfTemporalResolvePass.velocityPass.updateVelocityMaterialAfterRender(c)

			c.material = originalMaterial
		}
	}

	setDiffuseMaterialInScene() {
		for (const c of this.visibleMeshes) {
			c.material = this.cachedMaterials.get(c)[2]
		}
	}

	unsetDiffuseMaterialInScene() {
		for (const c of this.visibleMeshes) {
			// set material back to the original one
			const [originalMaterial] = this.cachedMaterials.get(c)

			c.material = originalMaterial
		}
	}

	render(renderer) {
		const { background } = this._scene

		this._scene.background = backgroundColor

		this.setMRTMaterialInScene()

		this.renderPass.render(renderer, this.gBuffersRenderTarget)

		this.unsetMRTMaterialInScene()

		if (!isWebGL2) {
			this.webgl1DepthPass.renderPass.render(renderer, this.webgl1DepthPass.renderTarget)

			this.setDiffuseMaterialInScene()
			this.renderPass.render(renderer, this.diffuseRenderTarget)
			this.unsetDiffuseMaterialInScene()
		}

		// update uniforms

		this.fullscreenMaterial.uniforms.samples.value = this.ssgiEffect.svgf.svgfTemporalResolvePass.samples
		this.fullscreenMaterial.uniforms.seed.value = Math.random()
		this.fullscreenMaterial.uniforms.cameraNear.value = this._camera.near
		this.fullscreenMaterial.uniforms.cameraFar.value = this._camera.far
		this.fullscreenMaterial.uniforms.viewMatrix.value.copy(this._camera.matrixWorldInverse)

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
